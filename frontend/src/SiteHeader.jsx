import logoImage from './assets/vnutour-logo.webp'
import { navigate, useLocation } from './router.js'

const navigationItems = [
  { label: 'HOME', href: '/#home' },
  { label: 'ABOUT US', href: '/#about' },
  { label: 'TOUR', href: '/#tour' },
  { label: 'SPONSERSHIP', href: '/tai-tro' },
  { label: 'FAQ', href: '/#faq' },
  { label: 'FRAME', href: '/frame' },
]

function handleNavigation(event, href) {
  // For anchor links on the same page (like /#about, /#tour, /#faq),
  // let the browser handle them natively for automatic smooth scrolling
  if (href.startsWith('/#')) {
    return
  }

  // For other non-internal links, do nothing
  if (!href.startsWith('/')) return

  // For other internal links, use the custom router
  event.preventDefault()
  navigate(href)
}

export function NavLinks({ className = '' }) {
  const { path } = useLocation()

  return (
    <nav
      aria-label="Điều hướng VNUTour"
      className={`items-center gap-7 text-xs font-bold uppercase tracking-[0.08em] text-[#0c1d33] ${className}`}
    >
      {navigationItems.map(item => {
        const isActive =
          (item.href === '/tai-tro' && path === '/tai-tro') ||
          (item.href === '/frame' && (path === '/frame' || path.startsWith('/frame/')))

        return (
          <a
            key={item.label}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            onClick={event => handleNavigation(event, item.href)}
            className={`landing-focus relative whitespace-nowrap py-2 transition-all duration-200 hover:-translate-y-0.5 hover:text-[#1478D4] ${
              isActive ? 'text-[#1478D4] after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-[#FFD54D]' : ''
            }`}
          >
            {item.label}
          </a>
        )
      })}
    </nav>
  )
}

export default function SiteHeader() {
  return (
    <header className="relative z-20 mx-3 mt-4 flex h-20 w-[calc(100%-1.5rem)] items-center justify-between rounded-2xl border border-white/75 bg-white/65 px-3 shadow-[0_12px_35px_rgba(12,29,51,0.08)] backdrop-blur-md md:mx-6 md:w-[calc(100%-3rem)] md:px-4 xl:mx-auto xl:w-full xl:max-w-[1400px]">
      <a
        href="/"
        aria-label="VNUTour trang chủ"
        onClick={event => handleNavigation(event, '/')}
        className="landing-focus flex h-16 w-16 shrink-0 items-center justify-center transition-transform duration-200 hover:-translate-y-0.5"
      >
        <img src={logoImage} alt="VNUTour" className="h-full w-full object-contain" />
      </a>

      <div className="flex items-center gap-4 lg:gap-7">
        <NavLinks className="hidden md:flex" />

        <a
          href="/login"
          onClick={event => handleNavigation(event, '/login')}
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