"""
QR-related commands
"""
from __future__ import annotations

import discord
from discord.ext import commands
from bson import ObjectId  # type: ignore


def setup_qr_commands(bot: commands.Bot):
    @bot.command(name="teamqr")
    @commands.has_permissions(administrator=True)
    async def teamqr(ctx: commands.Context):
        """Gửi QR định danh tới kênh text của từng đội.

        QR payload = base64url(ObjectId(team._id)) (không padding), có prefix 't:'.
        Frontend sẽ quét và gửi mã này về API `/api/checkin`.
        """
        mongo = getattr(bot, "mongo", None)
        if not mongo:
            await ctx.send("Lỗi: cơ sở dữ liệu MongoDB chưa được cấu hình.")
            return

        # Lazy imports to avoid hard requirements at import time
        try:
            import importlib.util, sys
            # Preflight module presence to avoid late failures
            if importlib.util.find_spec("qrcode") is None:
                raise ImportError("Module 'qrcode' not found")
            if importlib.util.find_spec("PIL") is None:
                raise ImportError("Module 'PIL' (Pillow) not found")
            import qrcode
            from PIL import Image  # noqa: F401
            import io
            import asyncio
            from ..utils.mongo import MongoManager as _Mongo
        except Exception as e:
            try:
                py = sys.executable
            except Exception:
                py = "python"
            await ctx.send(
                "Lỗi: thiếu thư viện (qrcode/Pillow).\n"
                f"Chi tiết: {e}\n"
                f"Interpreter: {py}. Hãy đảm bảo cài bằng: `{py} -m pip install qrcode[pil] Pillow`."
            )
            return

        try:
            teams = list(mongo.teams.find({}))
        except Exception as e:
            await ctx.send(f"Lỗi: không thể lấy danh sách đội: {e}")
            return
        if not teams:
            await ctx.send("Thông báo: không có đội trong cơ sở dữ liệu.")
            return

        sent = 0
        skipped = 0
        for t in teams:
            try:
                text_ch_id = t.get("text_channel_id")
                if not text_ch_id:
                    skipped += 1
                    continue
                ch = bot.get_channel(int(text_ch_id))
                if not isinstance(ch, discord.TextChannel):
                    skipped += 1
                    continue

                oid = t.get("_id")
                if not oid:
                    skipped += 1
                    continue
                code = _Mongo.encode_team_oid(str(oid)) or str(oid)
                payload = f"t:{code}"

                qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=2)
                qr.add_data(payload)
                qr.make(fit=True)
                img = qr.make_image(fill_color="black", back_color="white")
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                buf.seek(0)

                team_name = t.get("team_name") or (f"Team {t.get('team_id')}" if t.get("team_id") else "Team")
                embed = discord.Embed(
                    title=f"QR điểm danh của đội: {team_name}",
                    description="Vui lòng xuất trình QR khi điểm danh. \n Đội trưởng và các thành viên khác trong đội lưu mã QR để quá trình điểm danh hoàn thành nhanh nhất.\n Không chia sẻ mã này cho đội khác.",
                    color=0x2ecc71,
                )
                embed.add_field(name="Payload", value=f"`{payload}`", inline=False)

                await ch.send(embed=embed, file=discord.File(buf, filename="team_qr.png"))
                sent += 1
                await asyncio.sleep(1)
            except discord.Forbidden:
                skipped += 1
            except Exception:
                skipped += 1

        await ctx.send(f"Đã gửi QR cho {sent} đội, bỏ qua {skipped} (thiếu kênh text hoặc lỗi quyền).")

    @bot.command(name="resetcheckin")
    @commands.has_permissions(administrator=True)
    async def resetcheckin(ctx: commands.Context, *, team_key: str):
        """Reset trạng thái check-in của một đội (hoặc toàn bộ).

        - `!resetcheckin <team_id|team_name|object_id>`
        - `!resetcheckin all` để reset toàn bộ (chỉ nên dùng khi test).
        """

        mongo = getattr(bot, "mongo", None)
        if not mongo:
            await ctx.send("Lỗi: MongoDB chưa được cấu hình.")
            return

        team_key = team_key.strip()
        if not team_key:
            await ctx.send("Lỗi: vui lòng cung cấp team ID hoặc tên đội.")
            return

        if team_key.lower() in {"all", "*", "resetall"}:
            try:
                unset_result = mongo.teams.update_many({}, {"$unset": {"checked_in_at": ""}})
                del_result = mongo.checkins.delete_many({})
                await ctx.send(
                    f"✅ Đã reset `checked_in_at` cho {unset_result.modified_count} đội và xoá {del_result.deleted_count} bản ghi check-in."
                )
            except Exception as e:
                await ctx.send(f"Lỗi khi reset toàn bộ: {e}")
            return

        query_options = [
            {"team_id": team_key},
            {"team_name": team_key},
        ]
        try:
            query_options.insert(0, {"_id": ObjectId(team_key)})
        except Exception:
            pass

        team_doc = None
        for query in query_options:
            team_doc = mongo.teams.find_one(query)
            if team_doc:
                break

        if not team_doc:
            await ctx.send(f"Không tìm thấy đội với khoá `{team_key}`.")
            return

        team_oid = team_doc.get("_id")
        if isinstance(team_oid, str):
            try:
                team_oid = ObjectId(team_oid)
            except Exception:
                pass

        try:
            mongo.teams.update_one({"_id": team_oid}, {"$unset": {"checked_in_at": ""}})
            mongo.checkins.delete_many({"team_oid": team_oid})
            label = team_doc.get("team_name") or team_doc.get("team_id") or str(team_oid)
            await ctx.send(f"✅ Đã reset check-in cho đội `{label}`.")
        except Exception as e:
            await ctx.send(f"Lỗi khi reset check-in: {e}")
