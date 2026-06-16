import { useEffect, useRef, useState } from 'react'
import heroImage from './assets/vnutour-hero.jpg'
import logoImage from './assets/vnutour-logo.png'

const navigationItems = [
  { label: 'HOME', href: '#home' },
  { label: 'ABOUT US', href: '#about' },
  { label: 'TOUR', href: '#tour' },
  { label: 'PRICING', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
]

const aboutItems = [
  {
    stat: '129+',
    label: 'Đội hình tham gia',
    title: 'Kết nối tân sinh viên',
    body: 'VNUTour tạo cơ hội để các bạn tân sinh viên làm quen với nhịp sống đại học, gặp gỡ đồng đội mới và mở đầu hành trình tại ĐHQG-HCM bằng những trải nghiệm thật.',
  },
  {
    stat: '29.89K',
    label: 'Dấu ấn hoạt động',
    title: 'Khám phá qua thử thách',
    body: 'Mỗi chặng dừng được thiết kế như một thử thách nhỏ, giúp người tham gia hiểu thêm về không gian học tập, văn hóa sinh viên và tinh thần chủ động trong môi trường mới.',
  },
]

const tourNotes = [
  {
    title: 'Trạm trải nghiệm',
    body: 'Các đội lần lượt vượt qua những trạm hoạt động được đặt tại các khu vực nổi bật trong đô thị đại học.',
  },
  {
    title: 'Đồng đội và chiến thuật',
    body: 'Mỗi thử thách khuyến khích phối hợp nhanh, quan sát tốt và chia sẻ vai trò rõ ràng giữa các thành viên.',
  },
]

const prizeHighlights = [
  {
    label: 'Tổng giá trị giải vô địch',
    value: '29.000.000 VND',
  },
  {
    label: 'Tổng giá trị giải thưởng',
    value: '230.000.000 VND',
  },
]

const prizeItems = [
  {
    value: '01',
    title: '1 Giải nhất',
    body: '2.000.000 VND + Tài khoản DOL English kỳ hạn 6 tháng + Học bổng 50% Ares English.',
  },
  {
    value: '02',
    title: '1 Giải nhì',
    body: 'Tài khoản DOL English kỳ hạn 3 tháng + Học bổng 50% Ares English.',
  },
  {
    value: '03',
    title: '1 Giải ba',
    body: 'Tài khoản DOL English kỳ hạn 3 tháng + Học bổng 50% Ares English.',
  },
  {
    value: '04',
    title: '2 Giải phụ',
    body: 'Tài khoản DOL English kỳ hạn 1 tháng + Học bổng Ares English.',
  },
]

const revealDirections = {
  up: {
    hidden: 'translate-y-10 opacity-0 blur-sm',
    visible: 'translate-y-0 opacity-100 blur-0',
  },
  left: {
    hidden: 'translate-y-10 opacity-0 blur-sm',
    visible: 'translate-y-0 opacity-100 blur-0',
  },
  right: {
    hidden: 'translate-y-10 opacity-0 blur-sm',
    visible: 'translate-y-0 opacity-100 blur-0',
  },
  scale: {
    hidden: 'scale-[0.98] opacity-0 blur-sm',
    visible: 'scale-100 opacity-100 blur-0',
  },
}

function Reveal({ as = 'div', children, className = '', delay = 0, direction = 'up' }) {
  const ref = useRef(null)
  const [isVisible, setIsVisible] = useState(false)
  const Component = as
  const motion = revealDirections[direction] ?? revealDirections.up

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
      {
        rootMargin: '0px 0px -4% 0px',
        threshold: 0.08,
      },
    )

    observer.observe(node)

    return () => observer.disconnect()
  }, [])

  return (
    <Component
      ref={ref}
      style={{ transitionDelay: isVisible ? `${delay}ms` : '0ms' }}
      className={`transform-gpu transition-all duration-700 ease-out will-change-transform motion-reduce:translate-x-0 motion-reduce:translate-y-0 motion-reduce:scale-100 motion-reduce:opacity-100 motion-reduce:blur-0 ${isVisible ? motion.visible : motion.hidden} ${className}`}
    >
      {children}
    </Component>
  )
}

function NavLinks({ className = '' }) {
  return (
    <nav className={`flex flex-wrap items-center gap-x-8 gap-y-3 text-sm font-medium uppercase text-white ${className}`}>
      {navigationItems.map(item => (
        <a key={item.label} href={item.href} className="transition-opacity hover:opacity-70">
          {item.label}
        </a>
      ))}
    </nav>
  )
}

function MediaPanel({ className = '', variant = 'photo', children }) {
  return (
    <div className={`group relative overflow-hidden bg-[#c4c4c4] ${className}`}>
      <img
        src={heroImage}
        alt=""
        className={`h-full w-full object-cover opacity-70 transition-transform duration-[1200ms] ease-out group-hover:scale-105 ${variant === 'wide' ? 'object-[50%_58%]' : 'object-[38%_52%]'}`}
      />
      <div className="absolute inset-0 bg-[#0e1218]/20" />
      {children}
    </div>
  )
}

function PlayButton() {
  return (
    <span className="absolute left-6 top-6 flex h-12 w-12 items-center justify-center border-2 border-white text-white">
      <span className="ml-1 h-0 w-0 border-y-[10px] border-l-[16px] border-y-transparent border-l-white" />
    </span>
  )
}

function LandingPage() {
  return (
    <main className="min-h-screen bg-[#0e1218] font-['Lato',Arial,sans-serif] text-white">
      <section id="home" className="relative min-h-[760px] overflow-hidden lg:min-h-[1080px]">
        <img src={heroImage} alt="Sinh viên VNUTour tại khu Đô thị ĐHQG-HCM" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-black/60" />

        <header className="relative z-20 mx-auto flex h-24 w-full max-w-[1680px] items-center justify-between px-6 md:px-10 xl:px-0">
          <a href="#home" aria-label="VNUTour home" className="flex h-16 w-16 items-center justify-center md:h-20 md:w-20">
            <img src={logoImage} alt="VNUTour" className="h-full w-full object-contain" />
          </a>
          <div className="flex items-center gap-6">
            <NavLinks className="hidden md:flex" />
            <a
              href="/login"
              className="rounded-full border-2 border-white/70 px-5 py-2 text-sm font-bold uppercase text-white transition hover:border-white hover:bg-white hover:text-[#0e1218]"
            >
              Đăng nhập
            </a>
          </div>
        </header>

        <div className="relative z-10 mx-auto flex min-h-[660px] w-full max-w-[1680px] items-center px-6 pb-16 pt-10 md:px-10 lg:min-h-[970px] xl:px-0">
          <Reveal className="w-full max-w-[1220px] lg:ml-[26%]" delay={120}>
            <p className="mb-5 text-sm font-bold uppercase md:text-2xl">VNU TOUR</p>
            <h1 className="max-w-[1220px] text-5xl font-bold uppercase leading-tight sm:text-6xl lg:text-7xl xl:text-[96px]">
              Khám phá khu đô thị Đại học Quốc gia - HCM
            </h1>
            <p className="mt-8 max-w-[1068px] text-base leading-7 text-white/90 md:text-lg">
              Hành trình thực tế khám phá xoay quanh khu Đô thị ĐHQG-HCM dành riêng cho Tân sinh viên. Một trải nghiệm mới chưa từng có đang chờ đón bạn, nơi mà mỗi bước chân là một kỉ niệm, mỗi điểm đến là những dấu ấn khó phai.
            </p>
            <a
              href="#pricing"
              className="mt-10 inline-flex w-full max-w-[430px] items-center justify-center bg-[#0e1218] px-8 py-5 text-lg font-bold uppercase transition-colors hover:bg-white hover:text-[#0e1218] md:max-w-[751px]"
            >
              Đăng ký ngay
            </a>
          </Reveal>
        </div>
      </section>

      <section id="about" className="mx-auto w-full max-w-[1680px] px-6 py-20 md:px-10 lg:py-28 xl:px-0">
        <Reveal className="relative">
          <div className="relative">
            <h2 className="text-[46px] font-bold uppercase leading-[0.98] min-[560px]:text-[72px] xl:text-[96px] xl:leading-[0.92]">
              <span className="hidden items-center gap-10 whitespace-nowrap min-[1360px]:gap-16 xl:flex">
                <span>Hành trình chinh phục</span>
                <span className="mt-4 block h-[6px] w-40 bg-white min-[1360px]:w-[210px]" aria-hidden="true" />
              </span>
              <span className="hidden text-right xl:block">những thử thách mới</span>
              <span className="relative block whitespace-nowrap xl:hidden">
                Hành trình
                <span className="absolute right-0 top-[0.48em] block h-1 w-12 bg-white min-[560px]:w-32 md:w-72" aria-hidden="true" />
              </span>
              <span className="block xl:hidden">chinh phục</span>
              <span className="block xl:hidden">những thử</span>
              <span className="block xl:hidden">thách mới</span>
            </h2>
          </div>
        </Reveal>

        <div className="mt-16 grid gap-10 lg:grid-cols-[547px_1fr]">
          <Reveal direction="left">
            <MediaPanel className="min-h-[320px] lg:h-[418px]" />
          </Reveal>
          <Reveal direction="right" delay={120}>
            <MediaPanel className="min-h-[320px] lg:h-[418px]" variant="wide" />
          </Reveal>
        </div>

        <div className="mt-20 grid gap-14 lg:grid-cols-[547px_1fr]">
          <div className="space-y-14">
            {aboutItems.map((item, index) => (
              <Reveal key={item.stat} delay={index * 120}>
                <p className="text-5xl font-bold text-white/15 md:text-6xl">{item.stat}</p>
                <p className="mt-4 text-xl font-bold uppercase md:text-2xl">{item.label}</p>
              </Reveal>
            ))}
          </div>
          <div className="space-y-14">
            {aboutItems.map((item, index) => (
              <Reveal as="article" key={item.title} delay={index * 120 + 80}>
                <h3 className="text-xl font-bold uppercase md:text-2xl">{item.title}</h3>
                <p className="mt-4 max-w-[1090px] text-base leading-7 text-white/80 md:text-lg">{item.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="tour" className="mx-auto w-full max-w-[1680px] px-6 py-20 md:px-10 lg:py-28 xl:px-0">
        <Reveal className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <span className="mb-8 block h-2 w-36 bg-white" />
            <h2 className="max-w-[1450px] text-4xl font-bold uppercase leading-tight sm:text-5xl lg:text-7xl xl:text-[96px]">
              Bắt đầu hành trình khám phá
            </h2>
          </div>
        </Reveal>

        <Reveal as="p" className="mt-14 max-w-[1667px] text-base leading-7 text-white/80 md:text-lg" delay={100}>
          VNUTour đưa người tham gia đi qua những địa điểm quen mà lạ trong khu Đô thị ĐHQG-HCM. Từ các trạm thử thách đến khoảnh khắc về đích cuối hành trình, mỗi đội sẽ tự viết nên câu chuyện nhập học của mình.
        </Reveal>

        <div className="mt-16 grid gap-12 lg:grid-cols-2">
          {tourNotes.map((note, index) => (
            <Reveal as="article" key={note.title} delay={index * 120}>
              <h3 className="text-xl font-bold uppercase md:text-2xl">{note.title}</h3>
              <p className="mt-4 max-w-[793px] text-base leading-7 text-white/80 md:text-lg">{note.body}</p>
            </Reveal>
          ))}
        </div>

        <div className="mt-20 grid gap-8 lg:grid-cols-[0.95fr_1fr]">
          <Reveal direction="left">
            <MediaPanel className="min-h-[460px] lg:h-[817px]">
              <PlayButton />
            </MediaPanel>
          </Reveal>
          <div className="grid gap-8">
            <Reveal direction="right" delay={100}>
              <MediaPanel className="min-h-[300px] lg:h-[383px]" variant="wide">
                <PlayButton />
              </MediaPanel>
            </Reveal>
            <Reveal direction="right" delay={180}>
              <MediaPanel className="min-h-[300px] lg:h-[383px]" variant="wide">
                <PlayButton />
              </MediaPanel>
            </Reveal>
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-[1680px] px-6 py-20 md:px-10 lg:py-28 xl:px-0">
        <Reveal className="flex flex-col gap-8 border-t border-white/30 pt-12 lg:items-start">
          <h2 className="max-w-[1180px] text-4xl font-bold uppercase leading-tight sm:text-5xl lg:text-7xl">
            Giá trị giải thưởng
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {prizeHighlights.map((item, index) => (
            <Reveal
              as="article"
              key={item.label}
              className="border border-white/20 bg-white/[0.03] p-6 md:p-8"
              delay={index * 120}
              direction="scale"
            >
              <p className="text-sm font-bold uppercase text-white/70 md:text-lg">{item.label}</p>
              <p className="mt-4 text-4xl font-bold uppercase leading-none text-white sm:text-5xl lg:text-6xl">
                {item.value}
              </p>
            </Reveal>
          ))}
        </div>

        <div className="mt-12 divide-y divide-white/15">
          {prizeItems.map((item, index) => (
            <Reveal
              as="article"
              key={item.title}
              className="grid gap-5 py-8 md:grid-cols-[140px_1fr]"
              delay={index * 90}
            >
              <p className="text-5xl font-bold text-white/35">{item.value}</p>
              <div>
                <h3 className="text-lg font-bold uppercase md:text-xl">{item.title}</h3>
                <p className="mt-3 max-w-[980px] text-base leading-7 text-white/70">{item.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <span id="faq" className="block h-px" aria-hidden="true" />

      <footer className="border-t border-white/35">
        <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-12 px-6 py-16 md:px-10 lg:flex-row lg:items-end lg:justify-between lg:py-24 xl:px-0">
          <Reveal className="space-y-10">
            <img src={logoImage} alt="VNUTour" className="h-20 w-20 object-contain md:h-24 md:w-24" />
            <NavLinks />
          </Reveal>
          <Reveal as="p" className="text-sm uppercase leading-6 text-white/80 md:text-xl" delay={120}>
            Copyright © VNUTour
            <br />
            All rights reserved
          </Reveal>
        </div>
      </footer>
    </main>
  )
}

export default LandingPage
