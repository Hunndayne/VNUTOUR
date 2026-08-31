import { useEffect, useRef, useState } from 'react'
import oceanWavesBg from './assets/ocean-waves-bg.svg'
import logoImage from './assets/vnutour-logo.png'
import universityLogo from './assets/organizer-university.webp'
import youthUnionLogo from './assets/organizer-youth-union.webp'
import facultyLogo from './assets/organizer-faculty.webp'
import vnu2025 from './assets/vnutour-hero.jpg'
import SiteHeader, { NavLinks } from './SiteHeader.jsx'

const organizerLogos = [
  { src: universityLogo, alt: 'Trường Đại học Công nghệ Thông tin' },
  { src: youthUnionLogo, alt: 'Đoàn Thanh niên Cộng sản Hồ Chí Minh' },
  { src: facultyLogo, alt: 'Khoa Mạng máy tính và Truyền thông' },
]

const aboutItems = [
  {
    title: 'Kết nối',
    body: 'VNU Tour là chương trình hướng đến đối tượng các bạn tân sinh viên làm quen với nhịp sống đại học, gặp gỡ và bắt cặp các đồng đội mới nhằm tham gia vào hành trình tại ĐHQG-HCM thông qua những trải nghiệm và thử thách chân thật thử thách tính đoàn kết.',
  },
  {
    title: 'Trải nghiệm',
    body: 'Mỗi chặng dừng chân là một trường đại học thuộc ĐHQG-HCM, giúp các Newbie hiểu thêm về không gian học tập, văn hóa sinh viên của trường - nơi sẽ đồng hành cùng các bạn trong những năm tháng tiếp theo trên giảng đường đại học.',
  },
  {
    title: 'Thử thách',
    body: 'Vượt qua chuỗi trạm giải đố, mật thư và trò chơi teambuilding sôi nổi để rèn luyện kỹ năng mềm và rinh về những phần quà hấp dẫn từ BTC.',
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
    question: 'VNU Tour là gì mà hot thế nhờ?',
    answer: 'VNU Tour là “chiếc” tour siêu thực tế, xịn sò giúp các bạn tân sinh viên tham quan và khám phá các trường Đại học thuộc khu đô thị ĐHQG-HCM. Giúp các bạn Tân Sinh Viên thoát cảnh bỡ ngỡ và kết thêm nhiều bạn mới qua những thử thách tình bạn siêu thú vị',
  },
  {
    question: 'Tham gia VNU Tour, các bạn Tân Sinh Viên sẽ hời sẽ được những gì?',
    answer: 'Các út cưng khi tham gia sẽ có cơ hội để làm quen với những người bạn mới, tiếp cận với môi trường đại học, trải nghiệm những thử thách thú vị, đồng thời có cơ hội nhận liền tay những phần quà hấp dẫn từ BTC.',
  },
  {
    question: 'BTC ơi! Nếu một thành viên vắng mặt, cả đội còn được tham gia không?',
    answer: 'Thấu hiểu được nỗi lòng của các đôi chơi khi trong team không may có bạn vướng lịch, BTC vẫn sẽ tạo điều kiện để đội chơi vẫn có thể tiếp tục chuyến "hải trình" cùng các thành viên còn lại, nhưng để hành trình được trọn vẹn nhất. Các út iu hãy liên hệ ngay với BTC để được thông báo hoặc thay đổi thành viên trong trường hợp bất khả kháng nhé.',
  },
  {
    question: 'Nếu em chỉ có một mình thì có thể tham gia VNU Tour không nhỉ?',
    answer: 'Các út cưng đừng lo, BTC sẽ ghép các bạn tân sinh viên lại với nhau để tạo thành một đội chơi hoàn chỉnh. Vì vậy các bạn không phải lo đến cảnh đơn phương độc mã khi đến với chương trình đâu nhé. Hãy yên tâm và tham gia cùng BTC để có những trải nghiệm thật vui và đáng nhớ nào!',
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

function LandingPage() {
  const [isCtaPopping, setIsCtaPopping] = useState(false)

  const handleCtaClick = () => {
    setIsCtaPopping(true)
    window.setTimeout(() => setIsCtaPopping(false), 380)
  }

  return (
    <main className="landing-page min-h-screen min-h-[100dvh] bg-white font-display text-[#0c1d33]">
      <section id="home" className="landing-flow-hero relative min-h-screen min-h-[100dvh] overflow-hidden">
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

<SiteHeader />

<div className="relative z-10 mx-auto grid min-h-[calc(100vh-5rem)] min-h-[calc(100dvh-5rem)] w-full max-w-[1400px] content-start items-start gap-2 px-5 pb-12 pt-4 md:px-8 lg:grid-cols-[minmax(240px,1fr)_minmax(0,880px)] lg:content-normal lg:items-center lg:gap-12 lg:pb-16 lg:pt-8 xl:px-0">

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

  <h1 className="text-center text-[clamp(24px,6.5vw,48px)] font-bold uppercase leading-[1.1] tracking-[-0.03em] text-[#0c1d33] sm:text-left lg:text-[65px]">
    <span className="block whitespace-nowrap">
      Khám phá khu đô thị
    </span>
    <span className="block text-[#1478D4]">
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

          {/* Đã đổi grid-cols-[1.35fr_0.85fr_0.85fr] thành grid-cols-3 để 3 cột bằng nhau tuyệt đối */}
          <div className="mt-8 grid grid-cols-3 items-center gap-5 sm:gap-10 md:mt-10 lg:gap-16">
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
                  className="h-20 w-auto max-w-full object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.3)] sm:h-28 lg:h-36"
                />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

<section id="about" className="landing-about-section relative isolate w-full overflow-visible py-20 md:py-28 xl:py-36">
  <div className="relative z-10 mx-auto w-full max-w-[1400px] px-5 md:px-8 xl:px-0">
    
    {/* HEADER CĂN GIỮA + HIỆU ỨNG TEXT GRADIENT */}
    <Reveal className="flex flex-col items-center text-center">
      <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#0077b6]/20 bg-white/40 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-[#0077b6] backdrop-blur-md shadow-sm md:text-sm">
        <span className="h-2 w-2 rounded-full bg-[#0096c7] animate-pulse"></span>
        VNU TOUR 2026
      </span>

<h2 className="mx-auto max-w-[950px] bg-gradient-to-r from-[#032b43] via-[#005f73] to-[#0096c7] bg-clip-text text-3xl font-extrabold uppercase leading-[1.6] tracking-normal text-transparent drop-shadow-sm sm:text-4xl md:text-5xl md:leading-[1.5] lg:text-6xl lg:leading-[1.55]">
  Hành trình chào mừng <br className="hidden sm:block" />
  Tân Sinh Viên khóa 2026
</h2>

      <p className="mx-auto mt-6 max-w-[680px] text-base font-medium leading-relaxed text-[#023e8a]/90 md:text-lg">
        Khám phá khu đô thị ĐHQG-HCM
      </p>
    </Reveal>

{/* NỘI DUNG CARD KÍNH MỜ (GLASSMORPHISM) + HOVER GLOW */}
<div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-3 lg:mt-16 lg:gap-8">
  {aboutItems.map((item, index) => (
    <Reveal 
      as="article" 
      key={item.title} 
      delay={index * 100} 
      className="group relative rounded-2xl border border-white/60 bg-white/40 p-8 shadow-lg shadow-black/5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-[#0096c7]/40 hover:bg-white/70 hover:shadow-xl hover:shadow-[#0096c7]/10"
    >
      <h3 className="text-xl font-bold uppercase tracking-tight text-[#032b43] transition-colors duration-200 group-hover:text-[#0077b6] md:text-2xl">
        {item.title}
      </h3>

      <p className="mt-3 text-base leading-relaxed text-[#023e8a]/80">
        {item.body}
      </p>

      {/* Đường line hiệu ứng ở chân thẻ */}
      <div className="absolute bottom-0 left-8 right-8 h-[2px] scale-x-0 bg-gradient-to-r from-transparent via-[#0096c7] to-transparent transition-transform duration-500 group-hover:scale-x-100" />
    </Reveal>
  ))}
</div>
</div>
</section>

{/* Đã thu hẹp padding-top (pt-4 md:pt-6) để bức ảnh kéo sát lên trên */}
<section id="tour" className="landing-flow-tour landing-tour-section relative isolate overflow-visible pt-4 pb-16 md:pt-6 md:pb-24">
  <div className="mx-auto flex w-full max-w-[1200px] justify-center px-5 md:px-8 xl:px-0">
    <Reveal className="w-full overflow-hidden rounded-2xl shadow-xl">
      <img
        src={vnu2025}
        alt="Khoảnh khắc tập thể tại VNUTour"
        loading="lazy"
        className="aspect-[16/9] h-full w-full object-cover object-center transition-transform duration-700 hover:scale-[1.02] motion-reduce:transform-none"
      />
    </Reveal>
  </div>
        <div className="landing-accent-grid mt-14 grid gap-px lg:grid-cols-[1.15fr_0.85fr]">
          {prizeHighlights.map((item, index) => (
            <Reveal as="article" key={item.label} delay={index * 100} className="landing-panel bg-gradient-to-br from-[#E8FAFF] to-[#F0FAFF] border border-[#00B6F1]/20 p-7 md:p-10 rounded-xl">
              <p className="text-sm font-bold uppercase tracking-[0.08em] text-[#0c1d33]/55">{item.label}</p>
              <p className="mt-5 text-4xl font-bold uppercase leading-none tracking-[-0.04em] text-[#1478D4] sm:text-5xl lg:text-6xl">
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
  <section id="faq" className="landing-faq-section relative isolate overflow-hidden bg-[#083348] pb-20 pt-16 md:pb-28 md:pt-24 xl:pb-36">
  
  {/* ĐƯỜNG CHUYỂN SÓNG BIỂN NỐI LIỀN NỀN TRẮNG PHÍA TRÊN */}
  <div className="absolute left-0 right-0 top-0 w-full overflow-hidden leading-none">
    <svg className="relative block h-10 w-full text-white md:h-16 lg:h-20" viewBox="0 0 1200 120" preserveAspectRatio="none">
      <path d="M321.39,56.44c58-10.79,114.16-30.13,172-41.86,82.39-16.72,168.19-17.73,250.45-.39C823.78,31,906.67,72,985.66,92.83c70.05,18.48,146.53,26.09,214.34,3V0H0V27.35A600.21,600.21,0,0,0,321.39,56.44Z" fill="currentColor"></path>
    </svg>
  </div>

  {/* Nền hiệu ứng phát sáng nhẹ ở góc */}
  <div aria-hidden="true" className="pointer-events-none absolute -left-20 top-1/2 -z-10 h-96 w-96 -translate-y-1/2 rounded-full bg-[#0096c7]/20 blur-3xl" />

  <div className="relative z-10 mx-auto grid w-full max-w-[1400px] gap-12 px-5 pt-8 md:px-8 lg:grid-cols-[0.75fr_1.25fr] lg:gap-16 xl:px-0">
    
    {/* CỘT TIÊU ĐỀ BÊN TRÁI */}
    <Reveal className="lg:sticky lg:top-28 lg:h-fit">
      <span className="mb-4 inline-block text-xs font-bold uppercase tracking-[0.2em] text-[#00B6F1] md:text-sm">
        Cẩm năng giải đáp
      </span>
      
      <h2 className="text-3xl font-extrabold uppercase leading-[1.25] tracking-tight text-white sm:text-4xl lg:text-5xl">
        Câu hỏi <br className="hidden sm:block" />
        thường gặp
      </h2>
      
      <p className="mt-5 max-w-[430px] text-base leading-relaxed text-white/75 md:text-lg">
        Cẩm năng VNU Tour sẽ giúp các bạn thí sinh giải đáp các vấn đề thường gặp.
      </p>
    </Reveal>

    {/* CỘT DANH SÁCH ACCORDION BÊN PHẢI */}
    <Reveal className="flex flex-col gap-4">
      {faqItems.map(item => (
        <details 
          key={item.question} 
          className="group rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-md transition-all duration-300 hover:border-white/20 hover:bg-white/[0.08] open:border-[#00B6F1]/50 open:bg-white/[0.08]"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-bold uppercase leading-snug text-white transition-colors duration-200 group-open:text-[#00B6F1] md:text-lg [&::-webkit-details-marker]:hidden">
            <span>{item.question}</span>
            
            <span 
              aria-hidden="true" 
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/5 text-lg font-medium text-[#FFD54D] transition-transform duration-300 group-open:rotate-45 group-open:border-[#00B6F1] group-open:bg-[#00B6F1] group-open:text-white"
            >
              +
            </span>
          </summary>
          
          <p className="faq-answer mt-4 border-t border-white/10 pt-4 text-base leading-relaxed text-white/80">
            {item.answer}
          </p>
        </details>
      ))}
    </Reveal>

  </div>
</section>
<section className="relative isolate w-full overflow-hidden bg-[#083348] px-5 py-20 md:px-8 md:py-28 xl:px-0 xl:py-36">
  
  {/* DANH SÁCH BONG BÓNG XANH NỔI XUNG QUANH */}
  <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
    {/* Cụm bong bóng BÊN TRÁI */}
    <div className="absolute left-[8%] top-[20%] h-16 w-16 animate-pulse rounded-full border border-[#00B6F1]/40 bg-[#00B6F1]/15 backdrop-blur-[1px]" style={{ animationDuration: '4s' }} />
    <div className="absolute left-[18%] top-[35%] h-24 w-24 animate-pulse rounded-full border border-cyan-300/30 bg-[#0096c7]/20 backdrop-blur-[2px]" style={{ animationDuration: '6s' }} />
    <div className="absolute left-[12%] bottom-[20%] h-20 w-20 animate-pulse rounded-full border border-[#00B6F1]/30 bg-[#00B6F1]/10" style={{ animationDuration: '5s' }} />
    <div className="absolute left-[4%] bottom-[40%] h-10 w-10 rounded-full bg-cyan-400/20 blur-[1px]" />

    {/* Cụm bong bóng BÊN PHẢI */}
    <div className="absolute right-[10%] top-[15%] h-20 w-20 animate-pulse rounded-full border border-[#00B6F1]/40 bg-[#00B6F1]/15 backdrop-blur-[1px]" style={{ animationDuration: '5.5s' }} />
    <div className="absolute right-[7%] bottom-[25%] h-14 w-14 animate-pulse rounded-full border border-cyan-300/30 bg-[#0096c7]/20" style={{ animationDuration: '4.5s' }} />
    <div className="absolute right-[18%] bottom-[15%] h-28 w-28 animate-pulse rounded-full border border-[#00B6F1]/25 bg-[#00B6F1]/10 blur-[1px]" style={{ animationDuration: '7s' }} />
  </div>

  {/* Ánh sáng tỏa ra ở tâm giữa chữ */}
  <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[380px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#00B6F1]/20 blur-3xl" />

  {/* Đã loại bỏ border-t / landing-border-mid gây xuất hiện đường gạch ngang */}
  <Reveal className="relative z-10 mx-auto flex max-w-[1400px] flex-col items-center text-center">
    <div className="cta-heading-glow relative">
      <h2 className="relative z-10 max-w-[920px] text-3xl font-bold uppercase leading-[1.4] tracking-normal !text-white sm:text-4xl md:text-5xl md:leading-[1.35] lg:text-6xl lg:leading-[1.35]">
        Bạn đã sẵn sàng cho <br className="hidden sm:block" />
        hành trình đầu tiên chưa?
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
