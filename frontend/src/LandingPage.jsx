import { useEffect, useRef, useState } from 'react'
import oceanWavesBg from './assets/ocean-waves-bg.svg'
import logoImage from './assets/vnutour-logo.png'
import universityLogo from './assets/organizer-university.webp'
import youthUnionLogo from './assets/organizer-youth-union.webp'
import facultyLogo from './assets/organizer-faculty.webp'
import vnu2025 from './assets/vnutour-hero.jpg'

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

function NavLinks({ className = '', onDark = false }) {
  return (
    <nav
      aria-label="Điều hướng landing page"
      className={`items-center gap-7 text-xs font-bold uppercase tracking-[0.08em] ${onDark ? 'text-[#0c1d33]' : 'text-[#0c1d33]'} ${className}`}
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
    <header className="relative z-20 mx-3 mt-4 flex h-20 w-[calc(100%-1.5rem)] items-center justify-between rounded-2xl border border-white/75 bg-white/65 px-3 shadow-[0_12px_35px_rgba(12,29,51,0.08)] backdrop-blur-md md:mx-6 md:w-[calc(100%-3rem)] md:px-4 xl:mx-auto xl:w-full xl:max-w-[1400px]">
<a
  href="#home"
  aria-label="VNUTour home"
  className="
    landing-focus
    flex
    h-16
    w-16
    shrink-0
    items-center
    justify-center
    transition-transform
    duration-200
    hover:-translate-y-0.5
  "
>
  <img
    src={logoImage}
    alt="VNUTour"
    className="h-full w-full object-contain"
  />
</a>

      <div className="flex items-center gap-4 lg:gap-7">
        <NavLinks className="hidden md:flex" />

        <a
          href="/login"
          className="landing-focus landing-login-button inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full border-2 border-[#00B6F1] bg-white/85 px-4 text-xs font-bold uppercase tracking-[0.06em] text-[#00B6F1] transition-all duration-200 active:translate-y-px hover:bg-[#00B6F1] hover:text-white sm:px-5"
        >
          Đăng nhập
        </a>

        <details className="group relative md:hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-full border-2 border-[#1478D4] bg-[#1478D4] px-4 text-xs font-bold uppercase tracking-[0.06em] text-white shadow-[0_5px_14px_rgba(20,120,212,0.2)] transition-colors duration-200 hover:bg-[#0c1d33] [&::-webkit-details-marker]:hidden">
            Menu
          </summary>
          <NavLinks className="landing-mobile-menu absolute right-0 top-14 flex min-w-44 flex-col items-start gap-0 overflow-hidden border bg-white shadow-[0_18px_60px_rgba(4,18,31,0.15)] [&_a]:w-full [&_a]:px-5 [&_a]:py-4" />
        </details>
      </div>
    </header>
  )
}

function LandingPage() {
  const [isCtaPopping, setIsCtaPopping] = useState(false)

  const handleCtaClick = () => {
    setIsCtaPopping(true)
    window.setTimeout(() => setIsCtaPopping(false), 380)
  }

  return (
    <main className="landing-page min-h-[100dvh] bg-white font-display text-[#0c1d33]">
      <section id="home" className="landing-flow-hero relative min-h-[100dvh] overflow-hidden">
        <div
          aria-hidden="true"
          className="landing-color-strip absolute inset-x-0 top-0 z-30 h-1"
        />
        <img
          src={oceanWavesBg}
          alt="Sóng biển minh họa VNUTour"
          className="absolute inset-0 h-full w-full object-cover object-center"
          fetchPriority="high"
        />

<Header />

<div className="relative z-10 mx-auto grid min-h-[calc(100dvh-5rem)] w-full max-w-[1400px] content-start items-start gap-2 px-5 pb-12 pt-4 md:px-8 lg:grid-cols-[minmax(240px,1fr)_minmax(0,880px)] lg:content-normal lg:items-center lg:gap-12 lg:pb-16 lg:pt-8 xl:px-0">

  {/* VNU TOUR LOGO */}
  <Reveal className="order-1 flex w-full justify-center lg:border-r lg:border-[#1478D4]/20 lg:pr-12">
    <div className="relative flex items-center justify-center">

      {/* Main cyan glow */}
      <div
        aria-hidden="true"
        className="
          absolute
          h-[240px]
          w-[240px]
          rounded-full
          bg-[#39D5F4]/30
          blur-[55px]
          opacity-70
          sm:h-[300px]
          sm:w-[300px]
          lg:h-[380px]
          lg:w-[380px]
        "
      />

      {/* Warm yellow glow */}
      <div
        aria-hidden="true"
        className="
          absolute
          h-[150px]
          w-[150px]
          rounded-full
          bg-[#FFD54D]/20
          blur-[45px]
          opacity-60
          sm:h-[190px]
          sm:w-[190px]
          lg:h-[240px]
          lg:w-[240px]
        "
      />

      {/* Soft white highlight */}
      <div
        aria-hidden="true"
        className="
          absolute
          h-[100px]
          w-[100px]
          rounded-full
          bg-white/30
          blur-[35px]
          opacity-50
          sm:h-[130px]
          sm:w-[130px]
          lg:h-[170px]
          lg:w-[170px]
        "
      />

      {/* Logo */}
      <img
        src="https://storage.hiseku.net/BieuTrung.png?v=2026"
        alt="Biểu trưng chương trình VNUTour"
        className="
          relative
          z-10
          h-auto
          w-[210px]
          object-contain
          drop-shadow-[0_18px_35px_rgba(0,80,150,0.28)]
          logo-float
          sm:w-[260px]
          lg:w-full
          lg:max-w-[360px]
        "
      />

    </div>
  </Reveal>


  {/* HERO CONTENT */}
  <Reveal className="order-2 w-full max-w-[880px] text-left">

    <p className="landing-accent-soft mb-5 hidden text-xs font-bold uppercase tracking-[0.24em] text-[#1478D4] lg:block lg:text-sm">
      VNU TOUR
    </p>

    <h1 className="text-center text-[clamp(24px,7.7vw,32px)] font-bold uppercase leading-[0.94] tracking-[-0.045em] text-[#0c1d33] sm:text-left sm:text-6xl lg:text-[82px]">

      <span className="block whitespace-nowrap sm:hidden">
        Khám phá khu đô thị
      </span>

      <span className="block text-[#1478D4] sm:hidden">
        ĐHQG-HCM
      </span>

      <span className="hidden sm:block">
        Khám phá khu đô thị
      </span>

      <span className="hidden text-[#1478D4] sm:block">
        ĐHQG-HCM
      </span>

    </h1>

    <p className="mt-6 max-w-[610px] text-base leading-7 text-[#0c1d33]/75 md:text-lg">
      Hành trình dành cho tân sinh viên, kết nối đồng đội qua những trạm thử thách tại ĐHQG-HCM.
    </p>

    <div className="mt-8 flex flex-col gap-3 sm:flex-row">

      <a
        href="/login?mode=signup"
        className="
          landing-focus
          landing-primary-cta
          inline-flex
          min-h-13
          items-center
          justify-center
          whitespace-nowrap
          rounded-full
          px-7
          py-4
          text-sm
          font-bold
          uppercase
          tracking-[0.06em]
          transition-all
          duration-200
          active:translate-y-px
          hover:-translate-y-1
        "
      >
        Đăng ký ngay
      </a>

      <a
        href="#tour"
        className="
          landing-focus
          landing-secondary-cta
          inline-flex
          min-h-13
          items-center
          justify-center
          whitespace-nowrap
          rounded-full
          border-2
          border-[#00B6F1]
          bg-white/70
          px-7
          py-4
          text-sm
          font-bold
          uppercase
          tracking-[0.06em]
          text-[#00B6F1]
          transition-all
          duration-200
          active:translate-y-px
          hover:-translate-y-1
          hover:bg-[#00B6F1]
          hover:text-white
        "
      >
        Xem hành trình
      </a>

    </div>

  </Reveal>

</div>
      </section>

      <section id="organizers" className="landing-organizers-section landing-border-faint relative isolate overflow-visible">
        <div className="relative z-10 mx-auto w-full max-w-[1200px] px-5 py-12 md:px-8 md:py-16 xl:px-0 xl:py-20">
          <Reveal>
            <h2 className="text-center text-3xl font-bold uppercase leading-[1.02] tracking-[-0.035em] text-white/95 sm:text-4xl lg:text-5xl">
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
                  className="h-24 w-full object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.3)] sm:h-32 lg:h-44"
                />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="landing-about-section relative isolate w-full overflow-visible py-20 md:py-28 xl:py-36">
        <div className="relative z-10 mx-auto w-full max-w-[1400px] px-5 md:px-8 xl:px-0">
        <Reveal>
          <h2 className="max-w-[980px] text-4xl font-bold uppercase leading-[1.02] tracking-[-0.035em] text-[#0c1d33] sm:text-5xl lg:text-7xl">
            Một cách khác để bắt đầu đời sống đại học
          </h2>
          <p className="mt-7 max-w-[650px] text-base leading-7 text-[#0c1d33]/65 md:text-lg">
            Không chỉ đi qua các địa điểm, bạn còn học cách quan sát, phối hợp và tạo nên ký ức đầu tiên cùng đồng đội.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-10 md:grid-cols-2 md:gap-16 lg:mt-24">
          {aboutItems.map((item, index) => (
            <Reveal as="article" key={item.title} delay={index * 100} className="landing-border-soft border-t border-[#1478D4]/20 pt-7">
              <h3 className="text-2xl font-bold uppercase tracking-[-0.02em] text-[#0c1d33] md:text-3xl">{item.title}</h3>
              <p className="mt-4 max-w-[520px] text-base leading-7 text-[#0c1d33]/65">{item.body}</p>
            </Reveal>
          ))}
        </div>
        </div>
      </section>

      <section id="tour" className="landing-flow-tour landing-tour-section relative isolate overflow-visible">
        <div className="mx-auto grid w-full max-w-[1400px] gap-12 px-5 py-20 md:px-8 md:py-28 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-20 xl:px-0 xl:py-36">
          <Reveal className="overflow-hidden rounded-2xl">
            <img
              src={vnu2025}
              alt="Khoảnh khắc tập thể tại VNUTour"
              loading="lazy"
              className="aspect-[4/3] h-full w-full object-cover object-center transition-transform duration-700 hover:scale-[1.02] motion-reduce:transform-none"
            />
          </Reveal>

          <div>
            <Reveal>
              <h2 className="text-4xl font-bold uppercase leading-[1.02] tracking-[-0.035em] text-[#0c1d33] sm:text-5xl lg:text-6xl">
                Hành trình được tạo nên bởi chính bạn
              </h2>
              <p className="mt-6 max-w-[560px] text-base leading-7 text-[#0c1d33]/65">
                Từ trạm đầu tiên đến khoảnh khắc về đích, mỗi đội tự viết nên câu chuyện nhập học của mình.
              </p>
            </Reveal>

            <div className="mt-12 space-y-9">
              {tourNotes.map((note, index) => (
                <Reveal as="article" key={note.title} delay={index * 100} className="grid grid-cols-[44px_1fr] gap-4">
                  <p className="landing-accent-soft font-mono text-sm font-bold text-[#1478D4]">0{index + 1}</p>
                  <div>
                    <h3 className="text-xl font-bold uppercase text-[#0c1d33]">{note.title}</h3>
                    <p className="mt-3 text-base leading-7 text-[#0c1d33]/65">{note.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="sponsors" className="bg-gradient-to-b from-[#D9F5FF] to-[#E8F8FF]">
        <div className="mx-auto w-full max-w-[1400px] px-5 py-20 md:px-8 md:py-28 xl:px-0 xl:py-36">
          <div className="landing-border-soft grid gap-12 border-y border-[#00B6F1]/20 py-12 md:py-16 lg:grid-cols-[0.8fr_1.2fr] lg:items-end lg:gap-20">
            <Reveal>
              <p className="landing-accent-soft text-sm font-bold uppercase tracking-[0.16em] text-[#1478D4]">Đồng hành cùng VNUTour</p>
              <h2 className="mt-5 text-4xl font-bold uppercase leading-[1.02] tracking-[-0.035em] text-[#0c1d33] sm:text-5xl lg:text-7xl">
                Nhà tài trợ
              </h2>
            </Reveal>

            <Reveal delay={100}>
              <p className="landing-accent text-3xl font-bold uppercase tracking-[-0.03em] text-[#1478D4] sm:text-4xl">
                Chưa công bố
              </p>
              <h3 className="mt-8 text-xl font-bold uppercase text-[#0c1d33] sm:text-2xl">
                Trở thành nhà tài trợ của chương trình
              </h3>
              <p className="mt-4 max-w-[620px] text-base leading-7 text-[#0c1d33]/65">
                Liên hệ với Ban Tổ chức để cùng đồng hành và tạo nên một hành trình đáng nhớ dành cho tân sinh viên.
              </p>
              <a
                href="mailto:vnutour@suctremmt.com"
                className="landing-focus landing-accent mt-7 inline-flex border-b border-[#1478D4] pb-1 text-base font-bold text-[#1478D4] transition-opacity duration-200 hover:opacity-75"
              >
                vnutour@suctremmt.com
              </a>
            </Reveal>
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-[1400px] bg-gradient-to-b from-[#E8F8FF] to-white px-5 py-20 md:px-8 md:py-28 xl:px-0 xl:py-36">
        <Reveal>
          <h2 className="max-w-[900px] text-4xl font-bold uppercase leading-[1.02] tracking-[-0.035em] text-[#0c1d33] sm:text-5xl lg:text-7xl">
            Giá trị giải thưởng
          </h2>
        </Reveal>

        <div className="landing-accent-grid mt-14 grid gap-px lg:grid-cols-[1.15fr_0.85fr]">
          {prizeHighlights.map((item, index) => (
            <Reveal as="article" key={item.label} delay={index * 100} className="landing-panel bg-gradient-to-br from-[#E8FAFF] to-[#F0FAFF] border border-[#00B6F1]/20 p-7 md:p-10 rounded-xl">
              <p className="text-sm font-bold uppercase tracking-[0.08em] text-[#0c1d33]/55">{item.label}</p>
              <p className="landing-accent mt-5 text-4xl font-bold uppercase leading-none tracking-[-0.04em] text-[#1478D4] sm:text-5xl lg:text-6xl">
                {item.value}
              </p>
            </Reveal>
          ))}
        </div>

        <div className="mt-16 grid gap-x-12 md:grid-cols-2">
          {prizeItems.map((item, index) => (
            <Reveal as="article" key={item.title} delay={index * 70} className="grid grid-cols-[52px_1fr] gap-4 border-t border-[#1478D4]/20 py-7">
              <p className="font-mono text-sm font-bold text-[#0c1d33]/35">{item.value}</p>
              <div>
                <h3 className="text-lg font-bold uppercase text-[#0c1d33] md:text-xl">{item.title}</h3>
                <p className="mt-3 max-w-[520px] text-sm leading-6 text-[#0c1d33]/60 md:text-base md:leading-7">{item.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="faq" className="landing-faq-section relative isolate overflow-hidden bg-[#083348]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-0 h-40 bg-gradient-to-b from-[#2A7180]/35 to-transparent md:h-56" />
        <div className="relative z-10 mx-auto grid w-full max-w-[1400px] gap-12 px-5 py-20 md:px-8 md:py-28 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20 xl:px-0 xl:py-36">
          <Reveal>
            <h2 className="text-4xl font-bold uppercase leading-[1.02] tracking-[-0.035em] text-white sm:text-5xl lg:text-6xl">
              Câu hỏi thường gặp
            </h2>
            <p className="mt-6 max-w-[430px] text-base leading-7 text-white/65">
              Những thông tin cần biết trước khi bạn bắt đầu đăng ký.
            </p>
          </Reveal>

          <Reveal className="landing-border-mid border-t">
            {faqItems.map(item => (
              <details key={item.question} className="group border-b border-white/20 py-6">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-6 text-lg font-bold uppercase leading-6 text-white md:text-xl [&::-webkit-details-marker]:hidden">
                  <span>{item.question}</span>
                  <span aria-hidden="true" className="font-mono text-[#FFD54D] transition-transform duration-200 group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="faq-answer max-w-[720px] pt-4 text-base leading-7 text-white/90">{item.answer}</p>
              </details>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="w-full bg-[#083348] px-5 py-20 md:px-8 md:py-28 xl:px-0 xl:py-36">
        <Reveal className="landing-border-mid mx-auto flex max-w-[1400px] flex-col items-center border-t pt-12 text-center">
          <div className="cta-heading-glow relative">
            <h2 className="relative z-10 max-w-[920px] text-4xl font-bold uppercase leading-[1.02] tracking-[-0.035em] !text-white sm:text-5xl lg:text-7xl">
              Bạn đã sẵn sàng cho hành trình đầu tiên chưa?
            </h2>
          </div>
          <a
            href="/login?mode=signup"
            onClick={handleCtaClick}
            className={`landing-focus landing-primary-cta mt-9 inline-flex min-h-13 items-center justify-center whitespace-nowrap rounded-full px-8 py-4 text-sm font-bold uppercase tracking-[0.06em] transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:scale-105 hover:shadow-[0_0_30px_rgba(0,182,241,0.5)] active:scale-95 ${isCtaPopping ? 'cta-pop' : ''}`}
          >
            Đăng ký ngay
          </a>
        </Reveal>
      </section>

      <footer className="landing-footer landing-border-faint border-t bg-[#062A3B]">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-10 px-5 py-12 md:px-8 lg:flex-row lg:items-end lg:justify-between xl:px-0">
          <div className="space-y-8">
            <img src={logoImage} alt="VNUTour" className="h-20 w-20 object-contain drop-shadow-[0_0_16px_rgba(57,213,244,0.32)]" />
            <NavLinks className="flex flex-wrap" />
          </div>
          <p className="text-xs uppercase leading-6 tracking-[0.08em] text-white/75">
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
