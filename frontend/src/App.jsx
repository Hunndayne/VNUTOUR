import LandingPage from './LandingPage.jsx'
import CheckinPage from './CheckinPage.jsx'
import LoginPage from './LoginPage.jsx'

function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'

  if (path === '/checkin') {
    return (
      <div className="relative min-h-screen">
        <a
          href="/"
          className="fixed left-4 top-4 z-[60] rounded-full bg-white/95 px-4 py-2 text-sm font-semibold text-slate-800 shadow-lg transition hover:bg-white"
        >
          Trang chủ
        </a>
        <CheckinPage />
      </div>
    )
  }

  if (path === '/login') {
    return <LoginPage />
  }

  return <LandingPage />
}

export default App
