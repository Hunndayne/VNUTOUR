// tai-tro.jsx
// Trang Nhà Tài Trợ — đồng bộ theme với LandingPage (nền trắng, navy #0c1d33,
// accent #1478D4 / #00B6F1, vàng #FFD54D, block tối #083348 / #062A3B).

import React from "react";

/* ==========================================================================
   DỮ LIỆU — chỉnh sửa tại đây
   ========================================================================== */

const EVENT = {
  name: "VNUTOUR 2026",
  fullName: "Khám phá khu đô thị ĐHQG-HCM",
  organizer: "Khoa Mạng máy tính và Truyền thông — Trường ĐH Công nghệ Thông tin, ĐHQG-HCM",
  email: "vnutour@suctremmt.com",
  phone: "0123456789",
  phoneHref: "tel:+84123456789",
  fanpage: "https://www.facebook.com/VNUTour",
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
    tagline: "Đối tác chiến lược, độc quyền ngành hàng",
  },
  {
    id: "gold",
    name: "Vàng",
    price: "20.000.000đ+",
    icon: "🥇",
    highlight: false,
    tagline: "Hiện diện nổi bật xuyên suốt cuộc thi",
  },
  {
    id: "silver",
    name: "Bạc",
    price: "10.000.000đ+",
    icon: "🥈",
    highlight: false,
    tagline: "Quảng bá thương hiệu hiệu quả",
  },
  {
    id: "bronze",
    name: "Đồng",
    price: "5.000.000đ+",
    icon: "🥉",
    highlight: false,
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
  { label: "Danh xưng 'Nhà tài trợ Kim Cương' độc quyền ngành hàng", tiers: ["diamond"] },
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
    <div className="mx-auto mb-12 max-w-2xl text-center">
      {eyebrow && (
        <p className="mb-2 text-sm font-bold uppercase tracking-[0.16em] text-[#1478D4]">
          {eyebrow}
        </p>
      )}
      <h2 className="text-3xl font-bold uppercase leading-[1.02] tracking-[-0.035em] text-[#0c1d33] md:text-4xl">
        {title}
      </h2>
      {desc && <p className="mt-3 text-base leading-7 text-[#0c1d33]/65">{desc}</p>}
    </div>
  );
}

function TierCard({ tier }) {
  return (
    <article
      className={`relative flex flex-col rounded-xl border p-7 transition-all duration-200 hover:-translate-y-1 ${
        tier.highlight
          ? "border-[#1478D4] bg-gradient-to-br from-[#D9F5FF] to-[#E8FAFF] shadow-[0_12px_35px_rgba(20,120,212,0.15)]"
          : "border-[#00B6F1]/20 bg-gradient-to-br from-[#E8FAFF] to-[#F0FAFF] hover:border-[#00B6F1]/50"
      }`}
    >
      {tier.highlight && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#1478D4] px-3 py-1 text-xs font-bold uppercase tracking-[0.06em] text-white">
          Cao cấp nhất
        </span>
      )}
      <p className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white text-3xl shadow-[0_5px_14px_rgba(12,29,51,0.08)]">
        {tier.icon}
      </p>
      <h3 className="mt-4 text-center text-xl font-bold uppercase tracking-[-0.02em] text-[#0c1d33]">
        Nhà Tài Trợ {tier.name}
      </h3>
      <p className="mt-1 text-center text-2xl font-bold uppercase tracking-[-0.04em] text-[#1478D4]">
        {tier.price}
      </p>
      <p className="mt-2 text-center text-sm leading-6 text-[#0c1d33]/65">{tier.tagline}</p>
      <a
        href="#lien-he"
        className={`mt-6 inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full px-5 text-sm font-bold uppercase tracking-[0.06em] transition-all duration-200 active:translate-y-px ${
          tier.highlight
            ? "border-2 border-[#1478D4] bg-[#1478D4] text-white hover:border-[#0c1d33] hover:bg-[#0c1d33]"
            : "border-2 border-[#00B6F1] bg-white/85 text-[#00B6F1] hover:bg-[#00B6F1] hover:text-white"
        }`}
      >
        Liên hệ tài trợ
      </a>
    </article>
  );
}

function Check({ active }) {
  return active ? (
    <span className="font-bold text-[#1478D4]">✓</span>
  ) : (
    <span className="text-[#0c1d33]/25">—</span>
  );
}

/* ==========================================================================
   TRANG CHÍNH
   ========================================================================== */

export default function TaiTro() {
  return (
    <main className="min-h-[100dvh] bg-white font-display text-[#0c1d33]">
      {/* ===== HERO ===== */}
      {/* pb chừa sẵn khoảng cho card thống kê kéo lên -mt-10 bên dưới,
          tránh đè lên chữ khi tên đơn vị tổ chức xuống nhiều dòng. */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#D9F5FF] to-[#E8F8FF] px-5 pb-32 pt-20 text-center md:pb-40 md:pt-28 xl:pb-44 xl:pt-36">
        <div className="mx-auto w-full max-w-[1400px]">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#1478D4] md:text-sm">
            {EVENT.fullName}
          </p>
          <h1 className="mx-auto mt-3 max-w-3xl text-4xl font-bold uppercase leading-[1.02] tracking-[-0.035em] sm:text-5xl lg:text-7xl">
            Đồng Hành Cùng <span className="text-[#1478D4]">{EVENT.name}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-[#0c1d33]/65 md:text-lg">
            Trở thành nhà tài trợ của {EVENT.name} — kết nối thương hiệu của bạn với cộng đồng
            sinh viên công nghệ năng động nhất, do {EVENT.organizer} tổ chức.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <a
              href="#goi-tai-tro"
              className="inline-flex min-h-13 items-center justify-center whitespace-nowrap rounded-full border-2 border-[#1478D4] bg-[#1478D4] px-7 py-4 text-sm font-bold uppercase tracking-[0.06em] text-white transition-all duration-200 hover:-translate-y-1 hover:border-[#0c1d33] hover:bg-[#0c1d33] active:translate-y-px"
            >
              Xem các gói tài trợ
            </a>
            <a
              href="#lien-he"
              className="inline-flex min-h-13 items-center justify-center whitespace-nowrap rounded-full border-2 border-[#00B6F1] bg-white/70 px-7 py-4 text-sm font-bold uppercase tracking-[0.06em] text-[#00B6F1] transition-all duration-200 hover:-translate-y-1 hover:bg-[#00B6F1] hover:text-white active:translate-y-px"
            >
              Liên hệ ngay
            </a>
          </div>
        </div>
      </section>

      {/* ===== THỐNG KÊ ===== */}
      <section className="relative z-10 mx-auto w-full max-w-[1200px] px-5 md:px-8 xl:px-0">
        <div className="-mt-10 grid grid-cols-2 gap-4 rounded-2xl border border-[#00B6F1]/20 bg-white p-6 shadow-[0_12px_35px_rgba(12,29,51,0.08)] md:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-3xl font-bold uppercase tracking-[-0.04em] text-[#1478D4]">{s.value}</p>
              <p className="mt-1 text-sm leading-6 text-[#0c1d33]/65">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== GÓI TÀI TRỢ ===== */}
      <section id="goi-tai-tro" className="mx-auto w-full max-w-[1400px] px-5 py-20 md:px-8 md:py-28 xl:px-0 xl:py-36">
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
        <p className="mt-6 text-center text-sm text-[#0c1d33]/60">
          * Ban Tổ chức cũng chào đón các hình thức tài trợ hiện vật, dịch vụ và truyền thông.
        </p>
      </section>

      {/* ===== BẢNG QUYỀN LỢI ===== */}
      <section className="bg-gradient-to-b from-[#E8F8FF] to-white px-5 py-20 md:px-8 md:py-28 xl:px-0 xl:py-36">
        <div className="mx-auto w-full max-w-[1400px]">
          <SectionHeading
            eyebrow="Win – Win"
            title="Quyền Lợi Nhà Tài Trợ"
            desc="Bảng so sánh chi tiết quyền lợi giữa các hạng mục tài trợ."
          />
          <div className="overflow-x-auto rounded-xl border border-[#00B6F1]/20 shadow-[0_12px_35px_rgba(12,29,51,0.06)]">
            <table className="w-full min-w-[640px] bg-white text-sm">
              <thead>
                <tr className="bg-[#D9F5FF] text-[#0c1d33]">
                  <th className="px-4 py-3 text-left font-bold uppercase tracking-[0.08em]">Quyền lợi</th>
                  {TIERS.map((t) => (
                    <th key={t.id} className="px-4 py-3 text-center font-bold uppercase tracking-[0.08em]">
                      {t.icon} {t.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BENEFITS.map((b, i) => (
                  <tr key={b.label} className={`border-t border-[#00B6F1]/15 ${i % 2 ? "bg-[#F0FAFF]" : "bg-white"}`}>
                    <td className="px-4 py-3 leading-6 text-[#0c1d33]/80">{b.label}</td>
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
      <section className="mx-auto w-full max-w-[1400px] px-5 py-20 md:px-8 md:py-28 xl:px-0 xl:py-36">
        <SectionHeading
          eyebrow="Đồng hành cùng chúng tôi"
          title="Đơn Vị Tài Trợ & Đồng Hành"
        />
        <div className="grid gap-8 md:grid-cols-2">
          {Object.entries(SPONSORS).map(([group, logos]) => (
            <div
              key={group}
              className="rounded-xl border border-dashed border-[#00B6F1]/35 bg-gradient-to-br from-[#E8FAFF] to-[#F0FAFF] p-8 text-center"
            >
              <h3 className="text-lg font-bold uppercase tracking-[-0.02em] text-[#0c1d33]">{group}</h3>
              {logos.length === 0 ? (
                <p className="mt-4 font-mono text-sm font-bold text-[#FFD54D] drop-shadow-[0_1px_2px_rgba(12,29,51,0.4)]">
                  ⏳ Coming Soon
                </p>
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
      <section id="lien-he" className="relative overflow-hidden bg-[#083348] px-5 py-20 text-center md:px-8 md:py-28 xl:px-0 xl:py-36">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-0 h-40 bg-gradient-to-b from-[#2A7180]/35 to-transparent md:h-56" />
        <div className="relative z-10 mx-auto w-full max-w-[1400px]">
          <h2 className="mx-auto max-w-3xl text-4xl font-bold uppercase leading-[1.02] tracking-[-0.035em] text-white sm:text-5xl lg:text-6xl">
            Sẵn Sàng Đồng Hành Cùng <span className="text-[#FFD54D]">{EVENT.name}</span>?
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-base leading-7 text-white/65">
            Liên hệ Ban Tổ chức để nhận hồ sơ tài trợ chi tiết và trao đổi về gói hợp tác
            phù hợp nhất với doanh nghiệp của bạn.
          </p>
          <div className="mx-auto mt-8 flex max-w-3xl flex-col items-center justify-center gap-4 sm:flex-row sm:flex-wrap">
            <a
              href={`mailto:${EVENT.email}`}
              className="inline-flex min-h-13 items-center justify-center whitespace-nowrap rounded-full border-2 border-[#00B6F1] bg-[#00B6F1] px-7 py-4 text-sm font-bold uppercase tracking-[0.06em] text-white transition-all duration-200 hover:-translate-y-1 hover:border-[#39D5F4] hover:bg-[#39D5F4] active:translate-y-px"
            >
              ✉️ {EVENT.email}
            </a>
            <a
              href={EVENT.phoneHref}
              className="inline-flex min-h-13 items-center justify-center whitespace-nowrap rounded-full border-2 border-white/40 px-7 py-4 text-sm font-bold uppercase tracking-[0.06em] text-white transition-all duration-200 hover:-translate-y-1 hover:bg-white/10 active:translate-y-px"
            >
              📞 {EVENT.phone}
            </a>
            <a
              href={EVENT.fanpage}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-13 items-center justify-center whitespace-nowrap rounded-full border-2 border-white/40 px-7 py-4 text-sm font-bold uppercase tracking-[0.06em] text-white transition-all duration-200 hover:-translate-y-1 hover:bg-white/10 active:translate-y-px"
            >
              💬 Nhắn tin Fanpage
            </a>
          </div>
          <p className="mt-8 text-xs uppercase tracking-[0.08em] text-white/75">{EVENT.organizer}</p>
        </div>
      </section>
    </main>
  );
}
