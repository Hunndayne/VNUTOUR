import LandingPage from './LandingPage.jsx'
import RegisterPage from './RegisterPage.jsx'
import LoginPage from './LoginPage.jsx'
import AdminDashboard from './AdminDashboard.jsx'
import ParticipantDashboard from './ParticipantDashboard.jsx'
import FormResponses from './FormResponses.jsx'
import CoopDashboard from './CoopDashboard.jsx'
import { getStoredAuthToken, getStoredUser, isAdminRole } from './api.js'

const ROLE_ENTRY_PATHS = new Set(['/admin', '/participant', '/paticipant', '/coop', '/checkin'])

function redirectToRoot() {
  window.location.replace('/')
}

function renderDashboardByRole(role) {
  if (isAdminRole(role)) {
    return <AdminDashboard />
  }
  if (role === 'collab') {
    return <CoopDashboard />
  }
  if (role === 'participant') {
    return <ParticipantDashboard />
  }
  return <LandingPage />
}

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
      redirectToRoot()
      return null
    }
    return <LoginPage />
  }

  if (ROLE_ENTRY_PATHS.has(path)) {
    redirectToRoot()
    return null
  }

  if (path === '/form') {
    if (!isAuthenticated) {
      redirectToRoot()
      return null
    }
    if (user.role !== 'participant') {
      redirectToRoot()
      return null
    }
    return <FormResponses />
  }

  if (path === '/' || path === '/landing') {
    return isAuthenticated ? renderDashboardByRole(user.role) : <LandingPage />
  }

  redirectToRoot()
  return null
}

export default App
