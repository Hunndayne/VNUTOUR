import LandingPage from './LandingPage.jsx'
import RegisterPage from './RegisterPage.jsx'
import LoginPage from './LoginPage.jsx'
import AdminDashboard from './AdminDashboard.jsx'
import ParticipantDashboard from './ParticipantDashboard.jsx'
import FormResponses from './FormResponses.jsx'
import CoopDashboard from './CoopDashboard.jsx'
import { getStoredAuthToken, getStoredUser, redirectByRole } from './api.js'

function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  const authToken = getStoredAuthToken()
  const user = getStoredUser()
  const isAuthenticated = Boolean(authToken && user)

  if (path === '/register') {
    return <RegisterPage />
  }

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

  if (path === '/coop' || path === '/checkin') {
    if (!isAuthenticated) {
      window.location.replace('/')
      return null
    }

    if (!['admin', 'collab'].includes(user.role)) {
      redirectByRole(user.role)
      return null
    }

    return <CoopDashboard />
  }

  if (path === '/form') {
    if (!isAuthenticated) {
      window.location.replace('/')
      return null
    }
    if (user.role !== 'participant') {
      redirectByRole(user.role)
      return null
    }
    return <FormResponses />
  }

  if (path === '/' || path === '/landing') {
    return <LandingPage />
  }

  window.location.replace('/')
  return null
}

export default App
