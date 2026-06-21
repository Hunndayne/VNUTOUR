import LandingPage from './LandingPage.jsx'
import CheckinPage from './CheckinPage.jsx'
import LoginPage from './LoginPage.jsx'
import AdminDashboard from './AdminDashboard.jsx'
import ParticipantDashboard from './ParticipantDashboard.jsx'
import { getStoredAuthToken, getStoredUser, redirectByRole } from './api.js'

function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  const authToken = getStoredAuthToken()
  const user = getStoredUser()
  const isAuthenticated = Boolean(authToken && user)

  if (path === '/login') {
    if (isAuthenticated) {
      redirectByRole(user.role)
      return null
    }
    return <LoginPage />
  }

  if (path === '/admin') {
    if (!isAuthenticated) {
      window.location.replace('/')
      return null
    }
    return <AdminDashboard />
  }

  if (path === '/participant') {
    if (!isAuthenticated) {
      window.location.replace('/')
      return null
    }
    return <ParticipantDashboard />
  }

  if (path === '/checkin') {
    if (!isAuthenticated) {
      window.location.replace('/')
      return null
    }

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

  if (path === '/' || path === '/landing') {
    return <LandingPage />
  }

  window.location.replace('/')
  return null
}

export default App
