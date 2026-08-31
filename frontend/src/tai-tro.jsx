// tai-tro.jsx
// Trang Hồ sơ tài trợ VNU Tour 2026 — nội dung theo proposal chính thức,
// theme đồng bộ với LandingPage (trắng, navy #0c1d33, accent #1478D4/#00B6F1,
// vàng #FFD54D, block tối #083348).

import React from "react";
import universityLogo from "./assets/organizer-university.webp";
import youthUnionLogo from "./assets/organizer-youth-union.webp";
import facultyLogo from "./assets/organizer-faculty.webp";
import SiteHeader from "./SiteHeader.jsx";
/* ==========================================================================
   DỮ LIỆU — theo Hồ sơ tài trợ VNU Tour 2026
   ========================================================================== */

const EVENT = {
  name: "VNU Tour 2026",
  fullName: "Hành trình khám phá khu đô thị ĐHQG-HCM",
  organizer: "Đoàn khoa Mạng máy tính và Truyền thông — Trường ĐH Công nghệ Thông tin, ĐHQG-HCM",
  email: "vnutour@suctremmt.com",
  emblem: "https://storage.hiseku.net/BieuTrung.png?v=2026",
  fanpage: "https://www.facebook.com/VNUTour",
};

// Logo các đơn vị tổ chức — thứ tự hiển thị từ trái sang phải
const ORGANIZER_LOGOS = [
  { src: universityLogo, alt: "Trường Đại học Công nghệ Thông tin" },
  { src: youthUnionLogo, alt: "Đoàn Thanh niên Cộng sản Hồ Chí Minh" },
  { src: facultyLogo, alt: "Khoa Mạng máy tính và Truyền thông" },
];

const STATS = [
  { value: "14", label: "Mùa giải liên tiếp" },
  { value: "10+", label: "Năm tổ chức truyền thống" },
  { value: "500+", label: "Lượt sinh viên quan tâm mỗi mùa" },
  { value: "6", label: "Trường thành viên khối ĐHQG-HCM" },
];

const TIERS = [
  {
    id: "gold",
    name: "Vàng",
    price: "Trên 10 triệu",
    note: "Tối thiểu 50% hiện kim",
    icon: "🥇",
    highlight: true,
    tagline: "Hiện diện nổi bật nhất xuyên suốt chương trình",
  },
  {
    id: "silver",
    name: "Bạc",
    price: "6 – dưới 10 triệu",
    note: "Tối thiểu 50% hiện kim",
    icon: "🥈",
    highlight: false,
    tagline: "Quảng bá thương hiệu hiệu quả",
  },
  {
    id: "bronze",
    name: "Đồng",
    price: "3 – dưới 6 triệu",
    note: "Tối thiểu 50% hiện kim",
    icon: "🥉",
    highlight: false,
    tagline: "Đồng hành cùng tân sinh viên",
  },
  {
    id: "companion",
    name: "Đồng Hành",
    price: "Dưới 6 triệu",
    note: "Hiện vật",
    icon: "🤝",
    highlight: false,
    tagline: "Tài trợ hiện vật, sản phẩm, dịch vụ",
  },
];

// Quyền lợi theo bảng "Khung mức và quyền lợi tài trợ" trong proposal.
// tiers: "all" = mọi gói; values = hiển thị text riêng theo từng gói (null = không có).
const BENEFITS = [
  {
    label: "Bài viết giới thiệu nhà tài trợ trên fanpage (do NTT cung cấp)",
    values: { gold: "2 bài", silver: "1 bài", bronze: "1 bài", companion: "1 bài" },
  },
  { label: "Bài viết tri ân nhà tài trợ (sau chương trình)", tiers: "all" },
  {
    label: "Logo trên Standee, Backdrop",
    values: { gold: "Vị trí ưu tiên", silver: "✔", bronze: "✔", companion: "✔" },
  },
  {
    label: "Logo trên Video giới thiệu",
    values: { gold: "Xuyên suốt", silver: "5s đầu – 5s cuối", bronze: "5s đầu", companion: "✔" },
  },
  {
    label: "Logo trên bài đăng truyền thông",
    values: { gold: "Xuyên suốt", silver: "Xuyên suốt", bronze: "✔", companion: "✔" },
  },
  { label: "Logo trên bảng giải thưởng & ấn phẩm của BTC", tiers: "all" },
  { label: "Đặt standee giới thiệu do nhà tài trợ cung cấp (vòng loại & chung kết)", tiers: "all" },
  { label: "Hình ảnh nhà tài trợ quảng bá qua các bài viết truyền thông của fanpage", tiers: "all" },
  {
    label: "Câu hỏi về doanh nghiệp/sản phẩm trong vòng loại & chung kết",
    values: { gold: "10% câu hỏi", silver: "5% câu hỏi", bronze: "✔", companion: "✔" },
  },
  {
    label: "Hỗ trợ truyền thông tuyển dụng trên fanpage (tối đa 1 bài/tháng, 1 năm kể từ ngày ký HĐ)",
    values: { gold: "6 bài", silver: "4 bài", bronze: "3 bài", companion: "2 bài" },
  },
  { label: "Phát sản phẩm của nhà tài trợ dưới dạng quà tặng", tiers: "all" },
  { label: "Giới thiệu nhà tài trợ trong buổi khai mạc vòng loại & chung kết", tiers: "all" },
  { label: "Đại diện nhà tài trợ nhận quà lưu niệm trong lễ trao giải", tiers: "all" },
  { label: "Ưu tiên mời tham gia các hoạt động tiếp theo của Đoàn khoa", tiers: "all" },
  { label: "NTT được sử dụng hình ảnh, tư liệu chương trình để quảng bá riêng", tiers: "all" },
];

const TIMELINE = [
  {
    date: "21/8 – 5/9",
    title: "Coming Soon",
    items: [
      "Giới thiệu chương trình qua Fanpage và các đơn vị hỗ trợ truyền thông",
      "Thay mới avatar, cover Fanpage — hint chủ đề VNU Tour 2026",
      "Minigame tương tác dành cho sinh viên",
    ],
  },
  {
    date: "5/9 – 20/9",
    title: "Mở đơn đăng ký",
    items: [
      "Thông báo mở đơn, đặt bàn đăng ký trực tiếp tại trường",
      "Công bố chủ đề & thể lệ Vòng Loại",
      "Giới thiệu đặc quyền của nhà tài trợ dành cho sinh viên",
    ],
  },
  {
    date: "20/9 – 23/9",
    title: "Vòng Loại",
    items: [
      "Truyền thông trực tiếp Vòng loại, minigame “Lội ngược dòng”",
      "Công bố các đội góp mặt Vòng Chung kết",
      "Giới thiệu thể lệ Vòng Chung kết & đặc quyền nhà tài trợ",
    ],
  },
  {
    date: "27/9 – 4/10",
    title: "Vòng Chung kết",
    items: [
      "Truyền thông trực tiếp tại các trạm, giới thiệu các nhà tài trợ",
      "Trao giải nhà vô địch VNU Tour 2026",
      "Tri ân đơn vị, nhà tài trợ, BTC — video/album tổng kết",
    ],
  },
];

const SPONSOR_GROUPS = ["Đơn Vị Tài Trợ", "Đơn Vị Đồng Hành"];

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
          Danh hiệu cao nhất
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
      <p className="mt-1 text-center text-xs font-bold uppercase tracking-[0.08em] text-[#0c1d33]/50">
        ({tier.note})
      </p>
      <p className="mb-6 mt-2 text-center text-sm leading-6 text-[#0c1d33]/65">{tier.tagline}</p>
      <a
        href="#lien-he"
        className={`mt-auto inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full px-5 text-sm font-bold uppercase tracking-[0.06em] transition-all duration-200 active:translate-y-px ${
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

/** Ô giá trị trong bảng quyền lợi: text riêng theo gói, ✓, hoặc — */
function BenefitCell({ benefit, tierId }) {
  let content = benefit.values ? benefit.values[tierId] : "✔";
  if (!content) return <span className="text-[#0c1d33]/25">—</span>;
  if (content === "✔") return <span className="font-bold text-[#1478D4]">✓</span>;
  return <span className="text-xs font-semibold leading-4 text-[#0c1d33]/80">{content}</span>;
}

/* ==========================================================================
   TRANG CHÍNH
   ========================================================================== */

export default function TaiTro() {
  return (
    <main className="min-h-screen min-h-[100dvh] bg-white font-display text-[#0c1d33]">
      <SiteHeader />
      {/* ===== HERO ===== */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#D9F5FF] to-[#E8F8FF] px-5 pb-32 pt-20 text-center md:pb-40 md:pt-28 xl:pb-44 xl:pt-36">
        <div className="mx-auto w-full max-w-[1400px]">
          {/* Logo các đơn vị tổ chức */}
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-8 md:gap-14">
            {ORGANIZER_LOGOS.map((logo) => (
              <img
                key={logo.alt}
                src={logo.src}
                alt={logo.alt}
                className="h-14 object-contain md:h-20"
              />
            ))}
          </div>
          <p className="mt-10 text-xs font-bold uppercase tracking-[0.24em] text-[#1478D4] md:text-sm">
            Hồ sơ tài trợ · {EVENT.fullName}
          </p>
          <div className="mt-3 flex flex-col items-center justify-center gap-6 lg:flex-row">
            <img
              src={EVENT.emblem}
              alt={`Biểu trưng ${EVENT.name}`}
              className="h-32 w-auto object-contain drop-shadow-[0_10px_25px_rgba(0,80,150,0.25)] md:h-44"
            />
            <h1 className="max-w-3xl text-4xl font-bold uppercase leading-[1.02] tracking-[-0.035em] sm:text-5xl lg:text-left lg:text-7xl">
              Đồng hành cùng <span className="text-[#1478D4]">{EVENT.name}</span>
            </h1>
          </div>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-[#0c1d33]/65 md:text-lg">
            Chương trình thường niên dành cho tân sinh viên, một trong những hoạt động truyền thống
            của Trường ĐH Công nghệ Thông tin với sức lan tỏa mạnh mẽ trong khối ĐHQG-HCM — do{" "}
            {EVENT.organizer} tổ chức.
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
          eyebrow="Hạn mức tài trợ"
          title="Các gói tài trợ"
          desc="Bốn hạng mục với mức đóng góp và quyền lợi tương ứng, linh hoạt cả hiện kim lẫn hiện vật."
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((tier) => (
            <TierCard key={tier.id} tier={tier} />
          ))}
        </div>
      </section>

      {/* ===== BẢNG QUYỀN LỢI ===== */}
      <section className="bg-gradient-to-b from-[#E8F8FF] to-white px-5 py-20 md:px-8 md:py-28 xl:px-0 xl:py-36">
        <div className="mx-auto w-full max-w-[1400px]">
          <SectionHeading
            eyebrow="Win – Win"
            title="Khung mức & quyền lợi tài trợ"
            desc="Bảng so sánh chi tiết quyền lợi giữa các hạng mục tài trợ."
          />
          <div className="overflow-x-auto rounded-xl border border-[#00B6F1]/20 shadow-[0_12px_35px_rgba(12,29,51,0.06)]">
            <table className="w-full min-w-[760px] bg-white text-sm">
              <thead>
                <tr className="bg-[#D9F5FF] text-[#0c1d33]">
                  <th className="px-4 py-3 text-left font-bold uppercase tracking-[0.08em]">Quyền lợi nhà tài trợ</th>
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
                        <BenefitCell benefit={b} tierId={t.id} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ===== KẾ HOẠCH TRUYỀN THÔNG ===== */}
      <section className="mx-auto w-full max-w-[1400px] px-5 py-20 md:px-8 md:py-28 xl:px-0 xl:py-36">
        <SectionHeading
          eyebrow="Kế hoạch truyền thông"
          title="Hành trình truyền thông 2026"
          desc="Doanh nghiệp xuất hiện xuyên suốt các giai đoạn truyền thông của chương trình."
        />
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {TIMELINE.map((phase, i) => (
            <article
              key={phase.title}
              className="rounded-xl border border-[#00B6F1]/20 bg-gradient-to-br from-[#E8FAFF] to-[#F0FAFF] p-6"
            >
              <p className="font-mono text-sm font-bold text-[#1478D4]">{phase.date}</p>
              <h3 className="mt-2 text-lg font-bold uppercase tracking-[-0.02em] text-[#0c1d33]">
                {phase.title}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {phase.items.map((item) => (
                  <li key={item} className="flex gap-2 text-sm leading-6 text-[#0c1d33]/70">
                    <span aria-hidden="true" className="mt-0.5 text-[#00B6F1]">▸</span>
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-4 font-mono text-xs font-bold text-[#0c1d33]/30">0{i + 1}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ===== NHÀ TÀI TRỢ HIỆN TẠI ===== */}
      <section className="bg-gradient-to-b from-[#E8F8FF] to-white px-5 py-20 md:px-8 md:py-28 xl:px-0 xl:py-36">
        <div className="mx-auto w-full max-w-[1400px]">
          <SectionHeading
            eyebrow="Đồng hành cùng chúng tôi"
            title="Đơn vị tài trợ & đồng hành"
          />
          <div className="grid gap-8 md:grid-cols-2">
            {SPONSOR_GROUPS.map((group) => (
              <div
                key={group}
                className="rounded-xl border border-dashed border-[#00B6F1]/35 bg-white p-8 text-center"
              >
                <h3 className="text-lg font-bold uppercase tracking-[-0.02em] text-[#0c1d33]">{group}</h3>
                <p className="mt-4 font-mono text-sm font-bold text-[#FFD54D] drop-shadow-[0_1px_2px_rgba(12,29,51,0.4)]">
                  ⏳ Coming Soon
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== LIÊN HỆ / CTA ===== */}
      <section id="lien-he" className="relative overflow-hidden bg-[#083348] px-5 py-20 text-center md:px-8 md:py-28 xl:px-0 xl:py-36">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-0 h-40 bg-gradient-to-b from-[#2A7180]/35 to-transparent md:h-56" />
        <div className="relative z-10 mx-auto w-full max-w-[1400px]">
          <h2 className="mx-auto max-w-3xl text-4xl font-bold uppercase leading-[1.02] tracking-[-0.035em] text-white sm:text-5xl lg:text-6xl">
            Sẵn sàng đồng hành cùng <span className="text-[#FFD54D]">{EVENT.name}</span>?
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-base leading-7 text-white/65">
            Liên hệ Ban Tổ chức để nhận hồ sơ tài trợ chi tiết và trao đổi về gói hợp tác
            phù hợp nhất với doanh nghiệp của bạn.
          </p>

          <a
            href={`mailto:${EVENT.email}`}
            className="mt-10 inline-flex min-h-13 items-center justify-center whitespace-nowrap rounded-full border-2 border-[#00B6F1] bg-[#00B6F1] px-7 py-4 text-sm font-bold uppercase tracking-[0.06em] text-white transition-all duration-200 hover:-translate-y-1 hover:border-[#39D5F4] hover:bg-[#39D5F4] active:translate-y-px"
          >
            ✉️ {EVENT.email}
          </a>

          <a
            href={EVENT.fanpage}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-10 inline-flex min-h-13 items-center justify-center whitespace-nowrap rounded-full border-2 border-[#00B6F1] bg-[#00B6F1] px-7 py-4 text-sm font-bold uppercase tracking-[0.06em] text-white transition-all duration-200 hover:-translate-y-1 hover:border-[#39D5F4] hover:bg-[#39D5F4] active:translate-y-px"
          >
            💬 Fanpage VNU Tour
          </a>

          <p className="mt-8 text-xs uppercase tracking-[0.08em] text-white/75">{EVENT.organizer}</p>
        </div>
      </section>
    </main>
  );
}
