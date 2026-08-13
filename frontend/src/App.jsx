import { useEffect } from 'react'
import LandingPage from './LandingPage.jsx'
import LoginPage from './LoginPage.jsx'
import AdminDashboard from './AdminDashboard.jsx'
import ParticipantDashboard from './ParticipantDashboard.jsx'
import FormResponses from './FormResponses.jsx'
import CoopDashboard from './CoopDashboard.jsx'
import FramePage from './FramePage.jsx'
import { getStoredAuthToken, getStoredUser, isAdminRole, roleHomePath } from './api.js'
import { navigate, useLocation } from './router.js'

// Every screen used to render at `/`, with the role alone deciding what came
// back. That made a reload indistinguishable from a fresh visit — it always
// restarted at the top of the dashboard — and nothing could be linked or
// bookmarked. Each screen owns a path now.
const ROUTES = {
  '/admin': { render: () => <AdminDashboard />, allows: isAdminRole },
  '/coop': { render: () => <CoopDashboard />, allows: (role) => role === 'collab' },
  '/participant': { render: () => <ParticipantDashboard />, allows: (role) => role === 'participant' },
  '/form': { render: () => <FormResponses />, allows: (role) => role === 'participant' },
}

// Paths that used to exist, kept alive so old links and bookmarks still land
// somewhere sensible instead of bouncing to the landing page.
const LEGACY_PATHS = {
  '/paticipant': '/participant',
  '/checkin': '/coop',
  '/landing': '/',
}

// Routes that render for everyone — guest or signed-in, any role — and never
// redirect a signed-in visitor away the way `/` and `/login` do. The public
// photo-frame editor lives here: it has nothing to do with a VNUTour account.
const PUBLIC_PATHS = new Set(['/frame'])

/** `/admin/teams` still belongs to the `/admin` route — the rest is its tab. */
function routeRoot(path) {
  const [first] = path.split('/').filter(Boolean)
  return first ? `/${first}` : '/'
}

/**
 * Where this visit should actually end up, or `null` to render `path` as-is.
 * Kept a pure function so the redirect can be decided during render and
 * performed in an effect, rather than mutating history mid-render.
 */
function resolveRedirect({ path, search }, user) {
  const alias = LEGACY_PATHS[path]
  if (alias) return `${alias}${search}`

  // Public routes render as-is for every visitor — guest or signed-in — and
  // are exempt from the "signed-in users get bounced home" rule below.
  if (PUBLIC_PATHS.has(routeRoot(path))) return null

  const home = user ? roleHomePath(user.role) : '/'

  // A signed-in visitor has no business on the landing or login screens.
  if (path === '/' || path === '/login') {
    return user && home !== path ? home : null
  }

  const route = ROUTES[routeRoot(path)]
  if (!route) return home
  if (!user) return '/'
  if (!route.allows(user.role)) return home
  return null
}

function App() {
  const location = useLocation()
  const authToken = getStoredAuthToken()
  const storedUser = getStoredUser()
  const user = authToken && storedUser ? storedUser : null

  const redirect = resolveRedirect(location, user)

  useEffect(() => {
    // `replace`, not `push`: a correction is not a step the back button should
    // have to walk through.
    if (redirect) navigate(redirect, { replace: true })
  }, [redirect])

  if (redirect) return null
  if (location.path === '/login') return <LoginPage />
  if (PUBLIC_PATHS.has(routeRoot(location.path))) return <FramePage />

  const route = ROUTES[routeRoot(location.path)]
  return route ? route.render() : <LandingPage />
}

export default App
