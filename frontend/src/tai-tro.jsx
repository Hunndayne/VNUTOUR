// tai-tro.jsx
// Trang Nhà Tài Trợ — mô phỏng theo cấu trúc trang tài trợ AISC'26 (httt.uit.edu.vn/aisc/tai-tro)

import React from "react";

/* ==========================================================================
   DỮ LIỆU — chỉnh sửa tại đây
   ========================================================================== */

const EVENT = {
  name: "VNUTOUR 2026",
  fullName: "Khám phá khu đô thị ĐHQG-HCM",
  organizer: "Khoa Mạng máy tính và Truyền thông — Trường ĐH Công nghệ Thông tin, ĐHQG-HCM",
  email: "vnutour@suctremmt.com",
  phone: "028 3725 2002 (Ext: 119)",
  phoneHref: "tel:+842837252002",
  fanpage: "[facebook.com](https://www.facebook.com/VNUTour",
//   messenger: "[m.me](https://m.me/Cuocthihocthuat.AISC)",
};

const STATS = [
  { value: "500+", label: "Sinh viên tham gia mỗi mùa" },
  { value: "100+", label: "Đội thi đăng ký" },
  { value: "5+", label: "Mùa giải tổ chức thành công" },
  { value: "50K+", label: "Lượt tiếp cận truyền thông" },
];

const TIERS = [
  {
    id: "diamond",
    name: "Kim Cương",
    price: "30.000.000đ+",
    icon: "💎",
    highlight: true,
    color: "from-cyan-500 to-blue-600",
    tagline: "Đối tác chiến lược, độc quyền ngành hàng",
  },
  {
    id: "gold",
    name: "Vàng",
    price: "20.000.000đ+",
    icon: "🥇",
    highlight: false,
    color: "from-amber-400 to-yellow-600",
    tagline: "Hiện diện nổi bật xuyên suốt cuộc thi",
  },
  {
    id: "silver",
    name: "Bạc",
    price: "10.000.000đ+",
    icon: "🥈",
    highlight: false,
    color: "from-slate-400 to-slate-600",
    tagline: "Quảng bá thương hiệu hiệu quả",
  },
  {
    id: "bronze",
    name: "Đồng",
    price: "5.000.000đ+",
    icon: "🥉",
    highlight: false,
    color: "from-orange-400 to-orange-700",
    tagline: "Đồng hành cùng sinh viên",
  },
];

// Mỗi quyền lợi: tiers = danh sách id các gói được hưởng
const BENEFITS = [
  { label: "Logo trên toàn bộ ấn phẩm truyền thông (poster, banner, backdrop)", tiers: ["diamond", "gold", "silver", "bronze"] },
  { label: "Được vinh danh trong bài đăng cảm ơn trên Fanpage", tiers: ["diamond", "gold", "silver", "bronze"] },
  { label: "Nhận giấy chứng nhận / thư cảm ơn từ Ban Tổ chức", tiers: ["diamond", "gold", "silver", "bronze"] },
  { label: "Logo trên website chính thức của cuộc thi", tiers: ["diamond", "gold", "silver"] },
  { label: "Được nhắc tên trong các bài phát biểu khai mạc & bế mạc", tiers: ["diamond", "gold", "silver"] },
  { label: "Gian hàng / booth quảng bá tại Vòng Chung kết", tiers: ["diamond", "gold"] },
  { label: "Đại diện phát biểu và trao giải tại Vòng Chung kết", tiers: ["diamond", "gold"] },
  { label: "Bài đăng giới thiệu riêng về doanh nghiệp trên Fanpage", tiers: ["diamond", "gold"] },
  { label: "Đề xuất báo cáo viên cho chuyên đề seminar Vòng Chung kết", tiers: ["diamond"] },
  { label: "Tham gia thiết kế hoạt động chương trình", tiers: ["diamond"] },
  { label: "Danh xưng 'Nhà tài trợ Kim Cương' độc quyền ngành hàng", tiers: ["diamond"] },
  { label: "Tiếp cận hồ sơ đội thi xuất sắc (tuyển dụng / thực tập)", tiers: ["diamond"] },
];

// Logo nhà tài trợ đã xác nhận — để mảng rỗng sẽ hiện "Coming soon"
const SPONSORS = {
  "Đơn Vị Tài Trợ": [],
  "Đơn Vị Đồng Hành": [],
};

/* ==========================================================================
   COMPONENT PHỤ
   ========================================================================== */

function SectionHeading({ eyebrow, title, desc }) {
  return (
    <div className="text-center max-w-2xl mx-auto mb-12">
      {eyebrow && (
        <p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-2">
          {eyebrow}
        </p>
      )}
      <h2 className="text-3xl md:text-4xl font-bold text-slate-900">{title}</h2>
      {desc && <p className="mt-3 text-slate-600">{desc}</p>}
    </div>
  );
}

function TierCard({ tier }) {
  return (
    <div
      className={`relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm transition hover:shadow-lg ${
        tier.highlight ? "border-blue-500 ring-2 ring-blue-500/30 scale-[1.02]" : "border-slate-200"
      }`}
    >
      {tier.highlight && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
          Cao cấp nhất
        </span>
      )}
      <div
        className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br ${tier.color} text-3xl shadow`}
      >
        {tier.icon}
      </div>
      <h3 className="mt-4 text-center text-xl font-bold text-slate-900">
        Nhà Tài Trợ {tier.name}
      </h3>
      <p className="mt-1 text-center text-2xl font-extrabold text-blue-600">{tier.price}</p>
      <p className="mt-2 text-center text-sm text-slate-500">{tier.tagline}</p>
      <a
        href="#lien-he"
        className={`mt-6 rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition ${
          tier.highlight
            ? "bg-blue-600 text-white hover:bg-blue-700"
            : "border border-slate-300 text-slate-700 hover:border-blue-500 hover:text-blue-600"
        }`}
      >
        Liên hệ tài trợ
      </a>
    </div>
  );
}

function Check({ active }) {
  return active ? (
    <span className="font-bold text-emerald-600">✓</span>
  ) : (
    <span className="text-slate-300">—</span>
  );
}

/* ==========================================================================
   TRANG CHÍNH
   ========================================================================== */

export default function TaiTro() {
  return (
    <main className="bg-slate-50 text-slate-800">
      {/* ===== HERO ===== */}
      <section className="bg-gradient-to-br from-blue-700 via-blue-800 to-indigo-900 px-4 py-20 text-center text-white">
        <p className="text-sm font-semibold uppercase tracking-widest text-blue-200">
          {EVENT.fullName}
        </p>
        <h1 className="mx-auto mt-3 max-w-3xl text-4xl font-extrabold leading-tight md:text-5xl">
          Đồng Hành Cùng {EVENT.name}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-blue-100">
          Trở thành nhà tài trợ của {EVENT.name} — kết nối thương hiệu của bạn với cộng đồng
          sinh viên công nghệ năng động nhất, do {EVENT.organizer} tổ chức.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a
            href="#goi-tai-tro"
            className="rounded-xl bg-white px-6 py-3 font-semibold text-blue-700 shadow transition hover:bg-blue-50"
          >
            Xem các gói tài trợ
          </a>
          <a
            href="#lien-he"
            className="rounded-xl border border-white/40 px-6 py-3 font-semibold text-white transition hover:bg-white/10"
          >
            Liên hệ ngay
          </a>
        </div>
      </section>

      {/* ===== THỐNG KÊ ===== */}
      <section className="mx-auto -mt-10 max-w-5xl px-4">
        <div className="grid grid-cols-2 gap-4 rounded-2xl bg-white p-6 shadow-lg md:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-3xl font-extrabold text-blue-600">{s.value}</p>
              <p className="mt-1 text-sm text-slate-500">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== GÓI TÀI TRỢ ===== */}
      <section id="goi-tai-tro" className="mx-auto max-w-6xl px-4 py-20">
        <SectionHeading
          eyebrow="Hạng mục tài trợ"
          title="Các Gói Tài Trợ"
          desc="Lựa chọn gói tài trợ phù hợp với mục tiêu thương hiệu và ngân sách của doanh nghiệp."
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((tier) => (
            <TierCard key={tier.id} tier={tier} />
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          * Ban Tổ chức cũng chào đón các hình thức tài trợ hiện vật, dịch vụ và truyền thông.
        </p>
      </section>

      {/* ===== BẢNG QUYỀN LỢI ===== */}
      <section className="bg-white px-4 py-20">
        <div className="mx-auto max-w-6xl">
          <SectionHeading
            eyebrow="Win – Win"
            title="Quyền Lợi Nhà Tài Trợ"
            desc="Bảng so sánh chi tiết quyền lợi giữa các hạng mục tài trợ."
          />
          <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-slate-100 text-slate-700">
                  <th className="px-4 py-3 text-left font-semibold">Quyền lợi</th>
                  {TIERS.map((t) => (
                    <th key={t.id} className="px-4 py-3 text-center font-semibold">
                      {t.icon} {t.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BENEFITS.map((b, i) => (
                  <tr key={b.label} className={i % 2 ? "bg-slate-50" : "bg-white"}>
                    <td className="px-4 py-3">{b.label}</td>
                    {TIERS.map((t) => (
                      <td key={t.id} className="px-4 py-3 text-center">
                        <Check active={b.tiers.includes(t.id)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ===== NHÀ TÀI TRỢ HIỆN TẠI ===== */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <SectionHeading
          eyebrow="Đồng hành cùng chúng tôi"
          title="Đơn Vị Tài Trợ & Đồng Hành"
        />
        <div className="grid gap-8 md:grid-cols-2">
          {Object.entries(SPONSORS).map(([group, logos]) => (
            <div
              key={group}
              className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"
            >
              <h3 className="text-lg font-bold text-slate-900">{group}</h3>
              {logos.length === 0 ? (
                <p className="mt-4 text-slate-400">⏳ Coming Soon</p>
              ) : (
                <div className="mt-6 flex flex-wrap items-center justify-center gap-6">
                  {logos.map((logo) => (
                    <img
                      key={logo.name}
                      src={logo.src}
                      alt={logo.name}
                      className="h-14 object-contain"
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ===== LIÊN HỆ / CTA ===== */}
      <section
        id="lien-he"
        className="bg-gradient-to-br from-indigo-900 via-blue-800 to-blue-700 px-4 py-20 text-center text-white"
      >
        <h2 className="text-3xl font-bold md:text-4xl">Sẵn Sàng Đồng Hành Cùng {EVENT.name}?</h2>
        <p className="mx-auto mt-3 max-w-xl text-blue-100">
          Liên hệ Ban Tổ chức để nhận hồ sơ tài trợ chi tiết và trao đổi về gói hợp tác
          phù hợp nhất với doanh nghiệp của bạn.
        </p>
        <div className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-4">
          <a
            href={`mailto:${EVENT.email}`}
            className="rounded-xl bg-white px-6 py-3 font-semibold text-blue-700 shadow transition hover:bg-blue-50"
          >
            ✉️ {EVENT.email}
          </a>
          <a
            href={EVENT.phoneHref}
            className="rounded-xl border border-white/40 px-6 py-3 font-semibold transition hover:bg-white/10"
          >
            📞 {EVENT.phone}
          </a>
          <a
            href={EVENT.messenger}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-white/40 px-6 py-3 font-semibold transition hover:bg-white/10"
          >
            💬 Nhắn tin Fanpage
          </a>
        </div>
        <p className="mt-8 text-sm text-blue-200">{EVENT.organizer}</p>
      </section>
    </main>
  );
}
