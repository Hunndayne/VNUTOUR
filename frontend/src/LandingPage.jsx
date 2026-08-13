import { useEffect, useRef, useState } from 'react'
import heroImage from './assets/vnutour-hero.jpg'
import logoImage from './assets/vnutour-logo.png'
import universityLogo from './assets/organizer-university.webp'
import youthUnionLogo from './assets/organizer-youth-union.webp'
import facultyLogo from './assets/organizer-faculty.webp'

const navigationItems = [
  { label: 'HOME', href: '#home' },
  { label: 'ABOUT US', href: '#about' },
  { label: 'TOUR', href: '#tour' },
  { label: 'PRICING', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
  { label: 'GHÉP KHUNG ẢNH', href: '/frame' },
]

const organizerLogos = [
  { src: universityLogo, alt: 'Trường Đại học Công nghệ Thông tin' },
  { src: youthUnionLogo, alt: 'Đoàn Thanh niên Cộng sản Hồ Chí Minh' },
  { src: facultyLogo, alt: 'Khoa Mạng máy tính và Truyền thông' },
]

const aboutItems = [
  {
    title: 'Kết nối từ ngày đầu',
    body: 'Làm quen với nhịp sống đại học, gặp gỡ đồng đội mới và bắt đầu hành trình tại ĐHQG-HCM bằng trải nghiệm thật.',
  },
  {
    title: 'Khám phá bằng thử thách',
    body: 'Mỗi chặng dừng giúp bạn hiểu thêm về không gian học tập, văn hóa sinh viên và tinh thần chủ động trong môi trường mới.',
  },
]

const tourNotes = [
  {
    title: 'Đi qua những trạm trải nghiệm',
    body: 'Các đội lần lượt khám phá những khu vực nổi bật trong đô thị đại học qua chuỗi hoạt động được thiết kế có chủ đích.',
  },
  {
    title: 'Phối hợp để về đích',
    body: 'Mỗi thử thách khuyến khích quan sát nhanh, chia sẻ vai trò rõ ràng và đưa ra quyết định cùng đồng đội.',
  },
]

const prizeHighlights = [
  {
    label: 'Tổng giá trị giải vô địch',
    value: 'Chưa công bố',
  },
  {
    label: 'Tổng giá trị giải thưởng',
    value: 'Chưa công bố',
  },
]

const prizeItems = [
  {
    value: '01',
    title: '1 Giải nhất',
    body: 'Chưa công bố',
  },
  {
    value: '02',
    title: '1 Giải nhì',
    body: 'Chưa công bố',
  },
  {
    value: '03',
    title: '1 Giải ba',
    body: 'Chưa công bố',
  },
  {
    value: '04',
    title: '2 Giải phụ',
    body: 'Chưa công bố',
  },
]

const faqItems = [
  {
    question: 'Tham gia VNUTour, em sẽ được trải nghiệm những gì?',
    answer: 'Bạn sẽ khám phá các địa điểm nổi bật tại ĐHQG-HCM, vượt trạm thử thách cùng đồng đội, kết bạn mới và nhận những phần thưởng của chương trình.',
  },
  {
    question: 'Em không quen ai cả, có nên tham gia không?',
    answer: 'Có. Bạn có thể đăng ký cá nhân và BTC sẽ ghép các bạn thành đội 5 người. Đây cũng là cơ hội để làm quen với những người bạn mới.',
  },
  {
    question: 'Chương trình có yêu cầu thể lực nhiều không?',
    answer: 'Không. Các thử thách có mức vận động vừa phải, tập trung vào phối hợp, quan sát và tinh thần đồng đội, phù hợp với đa số sinh viên.',
  },
  {
    question: 'Nếu một thành viên vắng mặt, đội có được tham gia không?',
    answer: 'Có. Đội vẫn được tham gia với số thành viên còn lại, nhưng việc thiếu người có thể khiến một số thử thách khó hoàn thành hơn.',
  },
  {
    question: 'Em cần chuẩn bị gì khi tham gia?',
    answer: 'Hãy ăn sáng đầy đủ, mặc trang phục thoải mái, mang nước uống cá nhân và chuẩn bị tinh thần sẵn sàng phối hợp cùng đồng đội.',
  },
]

function Reveal({ as = 'div', children, className = '', delay = 0, direction = 'up' }) {
  const ref = useRef(null)
  const [isVisible, setIsVisible] = useState(false)
  const Component = as

  useEffect(() => {
    const node = ref.current

    if (!node) return undefined

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduceMotion || !('IntersectionObserver' in window)) {
      setIsVisible(true)
      return undefined
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -5% 0px', threshold: 0.08 },
    )

    observer.observe(node)

    return () => observer.disconnect()
  }, [])

  const visibleTransform = direction === 'right' ? 'translate-x-0' : 'translate-y-0'
  const hiddenTransform = direction === 'right' ? '-translate-x-20' : 'translate-y-6'
  const reducedMotionTransform = direction === 'right' ? 'motion-reduce:translate-x-0' : 'motion-reduce:translate-y-0'

  return (
    <Component
      ref={ref}
      style={{
        transitionDelay: isVisible ? `${delay}ms` : '0ms',
        willChange: isVisible ? 'auto' : 'transform, opacity',
      }}
      className={`transform-gpu transition-[transform,opacity] duration-700 ease-out ${reducedMotionTransform} motion-reduce:opacity-100 ${isVisible ? `${visibleTransform} opacity-100` : `${hiddenTransform} opacity-0`} ${className}`}
    >
      {children}
    </Component>
  )
}

function NavLinks({ className = '', onDark = true }) {
  return (
    <nav
      aria-label="Điều hướng landing page"
      className={`items-center gap-7 text-xs font-bold uppercase tracking-[0.08em] ${onDark ? 'text-white' : 'text-[#061a2b]'} ${className}`}
    >
      {navigationItems.map(item => (
        <a
          key={item.label}
          href={item.href}
          className="landing-focus whitespace-nowrap transition-opacity duration-200 hover:opacity-60"
        >
          {item.label}
        </a>
      ))}
    </nav>
  )
}

function Header() {
  return (
    <header className="relative z-20 mx-auto flex h-20 w-full max-w-[1400px] items-center justify-between px-5 md:px-8 xl:px-0">
      <a
        href="#home"
        aria-label="VNUTour home"
        className="landing-focus flex h-14 w-14 items-center justify-center"
      >
        <img src={logoImage} alt="VNUTour" className="h-full w-full object-contain" />
      </a>

      <div className="flex items-center gap-4 lg:gap-7">
        <NavLinks className="hidden md:flex" />
        <a
          href="/login"
          className="landing-focus landing-login-button inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full border px-5 text-xs font-bold uppercase tracking-[0.06em] transition-colors duration-200 active:translate-y-px"
        >
          Đăng nhập
        </a>

        <details className="group relative md:hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-full border border-white/70 px-4 text-xs font-bold uppercase tracking-[0.06em] text-white [&::-webkit-details-marker]:hidden">
            Menu
          </summary>
          <NavLinks className="landing-mobile-menu absolute right-0 top-14 flex min-w-44 flex-col items-start gap-0 overflow-hidden border shadow-[0_18px_60px_rgba(4,18,31,0.4)] [&_a]:w-full [&_a]:px-5 [&_a]:py-4" />
        </details>
      </div>
    </header>
  )
}

function LandingPage() {
  return (
    <main className="landing-page min-h-[100dvh] bg-[#061a2b] font-display text-white">
      <section id="home" className="relative min-h-[100dvh] overflow-hidden">
        <div
          aria-hidden="true"
          className="landing-color-strip absolute inset-x-0 top-0 z-30 h-1"
        />
        <img
          src={heroImage}
          alt="Sinh viên VNUTour tại khu Đô thị ĐHQG-HCM"
          className="absolute inset-0 h-full w-full object-cover object-[48%_50%]"
          fetchPriority="high"
        />
        <div className="landing-hero-overlay absolute inset-0" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,12,17,0.78)_0%,rgba(8,12,17,0.36)_72%,rgba(8,12,17,0.58)_100%)]" />

        <Header />

        <div className="relative z-10 mx-auto grid min-h-[calc(100dvh-5rem)] w-full max-w-[1400px] content-start items-start gap-2 px-5 pb-12 pt-4 md:px-8 lg:grid-cols-[minmax(240px,1fr)_minmax(0,880px)] lg:content-normal lg:items-center lg:gap-12 lg:pb-16 lg:pt-8 xl:px-0">
          <Reveal className="order-1 flex w-full justify-center lg:border-r lg:border-white/55 lg:pr-12">
            <img
              src="https://storage.hiseku.net/BieuTrung.png?v=2026"
              alt="Biểu trưng chương trình VNUTour"
              className="h-auto w-[210px] object-contain sm:w-[260px] lg:w-full lg:max-w-[360px]"
            />
          </Reveal>

          <Reveal className="order-2 w-full max-w-[880px] text-left">
            <p className="landing-accent-soft mb-5 hidden text-xs font-bold uppercase tracking-[0.24em] lg:block lg:text-sm">
              VNU TOUR
            </p>
            <h1 className="text-center text-[clamp(24px,7.7vw,32px)] font-bold uppercase leading-[0.94] tracking-[-0.045em] sm:text-left sm:text-6xl lg:text-[82px]">
              <span className="block whitespace-nowrap sm:hidden">Khám phá khu đô thị</span>
              <span className="block sm:hidden">ĐHQG-HCM</span>
              <span className="hidden sm:block">Khám phá khu đô thị</span>
              <span className="hidden sm:block">ĐHQG-HCM</span>
            </h1>
            <p className="mt-6 max-w-[610px] text-base leading-7 text-white/85 md:text-lg">
              Hành trình dành cho tân sinh viên, kết nối đồng đội qua những trạm thử thách tại ĐHQG-HCM.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="/login?mode=signup"
                className="landing-focus landing-primary-cta inline-flex min-h-13 items-center justify-center whitespace-nowrap rounded-full px-7 py-4 text-sm font-bold uppercase tracking-[0.06em] transition-colors duration-200 active:translate-y-px"
              >
                Đăng ký ngay
              </a>
              <a
                href="#tour"
                className="landing-focus landing-secondary-cta inline-flex min-h-13 items-center justify-center whitespace-nowrap rounded-full border px-7 py-4 text-sm font-bold uppercase tracking-[0.06em] transition-colors duration-200 active:translate-y-px"
              >
                Xem hành trình
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      <section id="organizers" className="landing-border-faint overflow-hidden border-y bg-black">
        <div className="mx-auto w-full max-w-[1200px] px-5 py-12 md:px-8 md:py-16 xl:px-0 xl:py-20">
          <Reveal>
            <h2 className="text-center text-3xl font-bold uppercase leading-[1.02] tracking-[-0.035em] sm:text-4xl lg:text-5xl">
              Ban tổ chức chương trình
            </h2>
          </Reveal>

          <div className="mt-8 grid grid-cols-[1.35fr_0.85fr_0.85fr] items-center gap-5 sm:gap-10 md:mt-10 lg:gap-16">
            {organizerLogos.map((logo, index) => (
              <Reveal
                key={logo.alt}
                direction="right"
                delay={index * 140}
                className="organizer-logo-entry flex min-w-0 items-center justify-center"
              >
                <img
                  src={logo.src}
                  alt={logo.alt}
                  loading="lazy"
                  className="h-24 w-full object-contain sm:h-32 lg:h-44"
                />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="mx-auto w-full max-w-[1400px] px-5 py-20 md:px-8 md:py-28 xl:px-0 xl:py-36">
        <Reveal>
          <h2 className="max-w-[980px] text-4xl font-bold uppercase leading-[1.02] tracking-[-0.035em] sm:text-5xl lg:text-7xl">
            Một cách khác để bắt đầu đời sống đại học
          </h2>
          <p className="mt-7 max-w-[650px] text-base leading-7 text-white/65 md:text-lg">
            Không chỉ đi qua các địa điểm, bạn còn học cách quan sát, phối hợp và tạo nên ký ức đầu tiên cùng đồng đội.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-10 md:grid-cols-2 md:gap-16 lg:mt-24">
          {aboutItems.map((item, index) => (
            <Reveal as="article" key={item.title} delay={index * 100} className="landing-border-soft border-t pt-7">
              <h3 className="text-2xl font-bold uppercase tracking-[-0.02em] md:text-3xl">{item.title}</h3>
              <p className="mt-4 max-w-[520px] text-base leading-7 text-white/65">{item.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="tour" className="landing-tour-section bg-[#0c5e22]">
        <div className="mx-auto grid w-full max-w-[1400px] gap-12 px-5 py-20 md:px-8 md:py-28 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-20 xl:px-0 xl:py-36">
          <Reveal className="overflow-hidden">
            <img
              src={heroImage}
              alt="Khoảnh khắc tập thể tại VNUTour"
              loading="lazy"
              className="aspect-[4/3] h-full w-full object-cover object-[49%_62%] transition-transform duration-700 hover:scale-[1.02] motion-reduce:transform-none"
            />
          </Reveal>

          <div>
            <Reveal>
              <h2 className="text-4xl font-bold uppercase leading-[1.02] tracking-[-0.035em] sm:text-5xl lg:text-6xl">
                Hành trình được tạo nên bởi chính bạn
              </h2>
              <p className="mt-6 max-w-[560px] text-base leading-7 text-white/65">
                Từ trạm đầu tiên đến khoảnh khắc về đích, mỗi đội tự viết nên câu chuyện nhập học của mình.
              </p>
            </Reveal>

            <div className="mt-12 space-y-9">
              {tourNotes.map((note, index) => (
                <Reveal as="article" key={note.title} delay={index * 100} className="grid grid-cols-[44px_1fr] gap-4">
                  <p className="landing-accent-soft font-mono text-sm font-bold">0{index + 1}</p>
                  <div>
                    <h3 className="text-xl font-bold uppercase">{note.title}</h3>
                    <p className="mt-3 text-base leading-7 text-white/65">{note.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="sponsors" className="bg-[#0a3f52]">
        <div className="mx-auto w-full max-w-[1400px] px-5 py-20 md:px-8 md:py-28 xl:px-0 xl:py-36">
          <div className="landing-border-soft grid gap-12 border-y py-12 md:py-16 lg:grid-cols-[0.8fr_1.2fr] lg:items-end lg:gap-20">
            <Reveal>
              <p className="landing-accent-soft text-sm font-bold uppercase tracking-[0.16em]">Đồng hành cùng VNUTour</p>
              <h2 className="mt-5 text-4xl font-bold uppercase leading-[1.02] tracking-[-0.035em] sm:text-5xl lg:text-7xl">
                Nhà tài trợ
              </h2>
            </Reveal>

            <Reveal delay={100}>
              <p className="landing-accent text-3xl font-bold uppercase tracking-[-0.03em] sm:text-4xl">
                Chưa công bố
              </p>
              <h3 className="mt-8 text-xl font-bold uppercase sm:text-2xl">
                Trở thành nhà tài trợ của chương trình
              </h3>
              <p className="mt-4 max-w-[620px] text-base leading-7 text-white/65">
                Liên hệ với Ban Tổ chức để cùng đồng hành và tạo nên một hành trình đáng nhớ dành cho tân sinh viên.
              </p>
              <a
                href="mailto:vnutour@suctremmt.com"
                className="landing-focus landing-accent mt-7 inline-flex border-b border-current pb-1 text-base font-bold transition-opacity duration-200 hover:opacity-75"
              >
                vnutour@suctremmt.com
              </a>
            </Reveal>
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-[1400px] px-5 py-20 md:px-8 md:py-28 xl:px-0 xl:py-36">
        <Reveal>
          <h2 className="max-w-[900px] text-4xl font-bold uppercase leading-[1.02] tracking-[-0.035em] sm:text-5xl lg:text-7xl">
            Giá trị giải thưởng
          </h2>
        </Reveal>

        <div className="landing-accent-grid mt-14 grid gap-px lg:grid-cols-[1.15fr_0.85fr]">
          {prizeHighlights.map((item, index) => (
            <Reveal as="article" key={item.label} delay={index * 100} className="landing-panel bg-[#061a2b] p-7 md:p-10">
              <p className="text-sm font-bold uppercase tracking-[0.08em] text-white/55">{item.label}</p>
              <p className="landing-accent mt-5 text-4xl font-bold uppercase leading-none tracking-[-0.04em] sm:text-5xl lg:text-6xl">
                {item.value}
              </p>
            </Reveal>
          ))}
        </div>

        <div className="mt-16 grid gap-x-12 md:grid-cols-2">
          {prizeItems.map((item, index) => (
            <Reveal as="article" key={item.title} delay={index * 70} className="grid grid-cols-[52px_1fr] gap-4 border-t border-white/20 py-7">
              <p className="font-mono text-sm font-bold text-white/35">{item.value}</p>
              <div>
                <h3 className="text-lg font-bold uppercase md:text-xl">{item.title}</h3>
                <p className="mt-3 max-w-[520px] text-sm leading-6 text-white/60 md:text-base md:leading-7">{item.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="faq" className="landing-faq-section bg-[#083348]">
        <div className="mx-auto grid w-full max-w-[1400px] gap-12 px-5 py-20 md:px-8 md:py-28 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20 xl:px-0 xl:py-36">
          <Reveal>
            <h2 className="text-4xl font-bold uppercase leading-[1.02] tracking-[-0.035em] sm:text-5xl lg:text-6xl">
              Câu hỏi thường gặp
            </h2>
            <p className="mt-6 max-w-[430px] text-base leading-7 text-white/65">
              Những thông tin cần biết trước khi bạn bắt đầu đăng ký.
            </p>
          </Reveal>

          <Reveal className="landing-border-mid border-t">
            {faqItems.map(item => (
              <details key={item.question} className="group border-b border-white/20 py-6">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-6 text-lg font-bold uppercase leading-6 [&::-webkit-details-marker]:hidden md:text-xl">
                  <span>{item.question}</span>
                  <span aria-hidden="true" className="landing-accent-neon font-mono transition-transform duration-200 group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="max-w-[720px] pt-4 text-base leading-7 text-white/65">{item.answer}</p>
              </details>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1400px] px-5 py-20 md:px-8 md:py-28 xl:px-0 xl:py-36">
        <Reveal className="landing-border-mid border-t pt-12">
          <h2 className="max-w-[920px] text-4xl font-bold uppercase leading-[1.02] tracking-[-0.035em] sm:text-5xl lg:text-7xl">
            Sẵn sàng cho hành trình đầu tiên?
          </h2>
          <a
            href="/login?mode=signup"
            className="landing-focus landing-primary-cta mt-9 inline-flex min-h-13 items-center justify-center whitespace-nowrap rounded-full px-8 py-4 text-sm font-bold uppercase tracking-[0.06em] transition-colors duration-200 active:translate-y-px"
          >
            Đăng ký ngay
          </a>
        </Reveal>
      </section>

      <footer className="landing-border-faint border-t">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-10 px-5 py-12 md:px-8 lg:flex-row lg:items-end lg:justify-between xl:px-0">
          <div className="space-y-8">
            <img src={logoImage} alt="VNUTour" className="h-20 w-20 object-contain" />
            <NavLinks className="flex flex-wrap" />
          </div>
          <p className="text-xs uppercase leading-6 tracking-[0.08em] text-white/55">
            Copyright © VNUTour
            <br />
            All rights reserved
          </p>
        </div>
      </footer>
    </main>
  )
}

export default LandingPage
