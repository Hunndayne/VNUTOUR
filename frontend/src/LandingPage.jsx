import { useEffect, useRef, useState } from 'react'
import oceanWavesBg from './assets/ocean-waves-bg.svg'
import logoImage from './assets/vnutour-logo.webp'
import universityLogo from './assets/organizer-university.webp'
import youthUnionLogo from './assets/organizer-youth-union.webp'
import facultyLogo from './assets/organizer-faculty.webp'
import SiteHeader, { NavLinks } from './SiteHeader.jsx'
import VNUTourJourneyMap from './VNUTourJourneyMap.jsx'

const organizerLogos = [
  { src: universityLogo, alt: 'Trường Đại học Công nghệ Thông tin' },
  { src: youthUnionLogo, alt: 'Đoàn Thanh niên Cộng sản Hồ Chí Minh' },
  { src: facultyLogo, alt: 'Khoa Mạng máy tính và Truyền thông' },
]

const aboutItems = [
  {
    title: 'Kết nối',
    body: 'VNU Tour là hành trình khám phá khu Đô thị ĐHQG-HCM do Đoàn khoa Mạng máy tính và Truyền thông – Trường Đại học Công nghệ Thông tin, ĐHQG-HCM tổ chức. Đây là sân chơi dành cho các Tân sinh viên ĐHQG-HCM cùng các trường đại học tại TP. Hồ Chí Minh, giúp các bạn có thể hòa nhập với môi trường đại học, tìm kiếm "đồng đội" và cùng trải nghiệm các thử thách teamwork đầy thú vị thông qua các trò chơi chạy trạm tại chương trình.',
  },
  {
    title: 'Trải nghiệm',
    body: 'Mỗi chặng dừng chân tại các trường thành viên thuộc ĐHQG-HCM sẽ giúp các Newbie khám phá không gian học tập và văn hóa sinh viên đặc trưng – nơi chắp cánh cho hành trình thanh xuân rực rỡ của các bạn trong những năm tháng đại học rực rỡ sắp tới.',
  },
  {
    title: 'Thử thách',
    body: 'Vượt qua chuỗi trạm giải đố, mật thư và teambuilding sôi động, các “út cưng” không chỉ được rèn luyện kỹ năng teamwork, tư duy xử lý tình huống mà còn có cơ hội rinh về vô số phần quà hấp dẫn từ Ban Tổ chức. ',
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
    question: 'Khi tham gia, em sẽ được trải nghiệm những gì vậy ạ? ',
    answer: ' Khi tham gia VNU TOUR 2026, bạn sẽ có cơ hội trực tiếp khám phá những địa điểm nổi bật tại khu Đô thị ĐHQG-HCM, cùng đồng đội giải mật thư và chinh phục các trạm thử thách kịch tính. Đây không chỉ là dịp tuyệt vời để kết nối với những người bạn mới mà còn mang về những phần quà hấp dẫn nữa đó! ',
  },
  {
    question: 'Em là “người siêu hướng nội” chưa quen ai cả, có nên tham gia không ạ?',
    answer: 'Hoàn toàn nên nhé! Bạn cứ mạnh dạn đăng ký cá nhân, BTC sẽ hỗ trợ kết nối và ghép bạn vào một đội hình 5 người hoàn chỉnh. Đây chính là "cơ hội vàng" để bạn thoát khỏi vùng an toàn và tìm thấy những người bạn chí cốt có thể sẽ cùng đồng hành suốt 4 năm đại học sắp tới.'
  },
  {
    question: 'Nếu đến ngày thi mà một thành viên trong đội có việc đột xuất vắng mặt thì đội có được thi tiếp không? ',
    answer: 'Có nhé! Đội của bạn vẫn được phép tiếp tục tham gia chương trình. Tuy nhiên, việc thiếu người có thể khiến đội gặp đôi chút bất lợi ở một số thử thách yêu cầu đủ quân số, vì vậy hãy cố gắng giữ liên lạc và động viên nhau tham gia thật đầy đủ nha.',
  },
  {
    question: 'Di chuyển giữa các trạm thi bằng cách nào, có được dùng xe máy hay phương tiện cá nhân không?',
    answer: ' Để đảm bảo tính công bằng và an toàn tuyệt đối, các đội chỉ di chuyển bằng cách đi bộ hoặc sử dụng xe buýt nội khu ĐHQG (không dùng phương tiện cá nhân). Đây cũng là dịp tuyệt vời để cả đội cùng nhau khám phá và check-in trọn vẹn Làng Đại học đó! ',
  },
   {
    question: 'Tụi em cần chuẩn bị những gì trước khi bước vào ngày thi ạ? ',
    answer: 'Bạn nên cần ăn sáng đầy đủ, mặc trang phục thoải mái để dễ dàng vận động, mang theo nước uống và nón che nắng. Quan trọng nhất là chuẩn bị một chiếc điện thoại đầy pin cùng tinh thần thật "cháy" để sẵn sàng bung xõa cùng VNU Tour 2026 nhé!',
  },
]

const registrationDeadline = Date.UTC(2026, 8, 12, 13, 0, 0)

export function Reveal({ as = 'div', children, className = '', delay = 0, direction = 'up' }) {
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
  const [timeRemaining, setTimeRemaining] = useState(() => Math.max(0, registrationDeadline - Date.now()))

  useEffect(() => {
    const updateCountdown = () => setTimeRemaining(Math.max(0, registrationDeadline - Date.now()))
    const intervalId = window.setInterval(updateCountdown, 1000)

    updateCountdown()
    return () => window.clearInterval(intervalId)
  }, [registrationDeadline])

  const handleCtaClick = () => {
    setIsCtaPopping(true)
    window.setTimeout(() => setIsCtaPopping(false), 380)
  }

  const totalSeconds = Math.floor(timeRemaining / 1000)
  const countdownValues = [
    Math.floor(totalSeconds / 86400),
    Math.floor((totalSeconds % 86400) / 3600),
    Math.floor((totalSeconds % 3600) / 60),
    totalSeconds % 60,
  ]

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

<SiteHeader />

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

  <div className="mt-8 flex flex-col items-start gap-4">
    <div className="flex w-full flex-col items-center gap-3 sm:grid sm:grid-cols-[minmax(0,250px)_max-content] sm:items-center sm:gap-10">
      <a
        href="/login?mode=signup"
        className="
          landing-focus
          landing-primary-cta
          inline-flex
          min-h-11
          w-[168px]
          items-center
          justify-center
          whitespace-nowrap
          rounded-full
          px-5
          py-3
          text-xs
          font-bold
          leading-none
          uppercase
          tracking-[0.06em]
          transition-all
          duration-200
          active:translate-y-px
          hover:-translate-y-1
          sm:justify-self-start
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
    min-h-11
    w-[168px]
    -translate-x-1
    items-center
    justify-center
    whitespace-nowrap
    rounded-full
    border-2
    border-[#00B6F1]
    bg-white/70
    px-5
    py-3
    text-xs
    font-bold
    leading-none
    uppercase
    tracking-[0.06em]
    text-[#00B6F1]
    transition-all
    duration-200
    active:translate-y-px
    hover:-translate-y-1
    hover:bg-[#00B6F1]
    hover:text-[#0c1d33]
    sm:justify-self-center
  "
>
  Xem hành trình
      </a>
    </div>

    <div className="grid w-full max-w-[560px] grid-cols-1 gap-3 text-center text-[#0c1d33] sm:grid-cols-[minmax(0,250px)_max-content] sm:items-start sm:gap-10 sm:text-left" aria-live="polite">
        <div>
          {timeRemaining > 0 ? (
            <>
              <p className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.12em] text-[#1478D4]">⌛ Thời gian còn lại</p>
              <div className="mt-1.5 grid grid-cols-4 gap-1">
                {countdownValues.map((value, index) => (
                  <div key={index}>
                    <span className="flex h-8 items-center justify-center rounded-md bg-white/75 px-1 text-base font-bold tabular-nums shadow-sm ring-1 ring-[#1478D4]/15 sm:h-9">
                      {String(value).padStart(2, '0')}
                    </span>
                    <span className="mt-0.5 block text-[8px] font-bold uppercase tracking-[0.03em] text-[#0c1d33]/65">
                      {['Ngày', 'Giờ', 'Phút', 'Giây'][index]}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#1478D4]">Đã hết hạn đăng ký</p>
          )}
        </div>
<div className="sm:pt-0.5 ml-4"> {/* Thay ml-4 bằng ml-6, ml-8... tùy bạn muốn dịch sang phải nhiều hay ít */}
  <p className="whitespace-nowrap text-xs font-bold uppercase leading-none tracking-[0.06em] text-[#1478D4]">Lệ phí tham gia:</p>
  <p className="mt-1 text-lg font-extrabold text-[#FFD54D]">25.000 VNĐ</p>
</div>
    </div>

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
  <VNUTourJourneyMap />
       <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
  {/* Phần 1: Highlight giải thưởng */}
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

  {/* Phần 2: Danh sách chi tiết giải thưởng */}
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
</div>

<div className="w-full max-w-[1350px] ml-auto px-5 py-20 md:px-8 md:py-28 xl:px-8 xl:py-36 lg:pr-16">
  <div className="landing-border-soft grid gap-12 border-y border-[#00B6F1]/20 py-12 md:py-16 lg:grid-cols-[0.8fr_1.2fr] lg:items-stretch lg:gap-20">
    <Reveal>
      <div className="h-full flex flex-col justify-center">
        <p className="landing-accent-soft text-sm font-bold uppercase tracking-[0.16em] text-[#1478D4]">Đồng hành cùng VNUTour</p>
        <h2 className="mt-5 text-4xl font-bold uppercase leading-[1.02] tracking-[-0.035em] text-[#0c1d33] sm:text-5xl lg:text-7xl">
          Nhà tài trợ
        </h2>
      </div>
    </Reveal>

    <Reveal delay={100}>
      <div className="h-full flex flex-col justify-center">
        <p className="landing-accent text-3xl font-bold uppercase tracking-[-0.03em] text-[#1478D4] sm:text-4xl">
          Chưa công bố
        </p>
        <h3 className="mt-8 text-xl font-bold uppercase text-[#0c1d33] sm:text-2xl">
          Trở thành nhà tài trợ của chương trình
        </h3>
        <p className="mt-4 max-w-[620px] text-base leading-7 text-[#0c1d33]/65">
          Liên hệ với Ban Tổ chức để cùng đồng hành và tạo nên một hành trình đáng nhớ dành cho tân sinh viên.
        </p>
        <div>
          <a
            href="/tai-tro"
            className="landing-focus landing-primary-cta mt-7 inline-flex min-h-13 items-center justify-center whitespace-nowrap rounded-full px-8 py-4 text-sm font-bold uppercase tracking-[0.06em] transition-all duration-200 active:translate-y-px hover:-translate-y-1"
          >
            Quyền lợi tài trợ
          </a>
        </div>
      </div>
    </Reveal>
  </div>
</div>
      </section>
  <section id="faq" className="landing-faq-section relative isolate overflow-hidden bg-[#083348] pb-20 pt-16 md:pb-28 md:pt-24 xl:pb-36">
  
  {/* ĐƯỜNG CHUYỂN SÓNG BIỂN NỐI LIỀN NỀN TRẮNG PHÍA TRÊN */}
  <div className="absolute left-0 right-0 top-0 w-full overflow-hidden leading-none">
    <svg className="relative block h-10 w-full text-[#d9f5ff] md:h-16 lg:h-20" viewBox="0 0 1200 120" preserveAspectRatio="none">
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
