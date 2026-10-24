import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router'
import { AuthProvider } from './components/AuthProvider'
import { Layout } from './components/Layout'
import { Loading } from './components/ui'
import { useAuth } from './lib/auth'
import { BuildingDetailPage } from './pages/BuildingDetailPage'
import { BuildingsPage } from './pages/BuildingsPage'
import { ListingDetailPage } from './pages/ListingDetailPage'
import { ListingsPage } from './pages/ListingsPage'
import { LoginPage } from './pages/LoginPage'
import { NewListingPage } from './pages/NewListingPage'
import { ProfilePage } from './pages/ProfilePage'
import { SeekingPage } from './pages/SeekingPage'

// Logged-out users go to /login; users without a profile go to onboarding (/profile).
function RequireAuth() {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="p-8">
        <Loading />
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  if (!profile && location.pathname !== '/profile') return <Navigate to="/profile" replace />
  return <Outlet />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route index element={<ListingsPage />} />
              <Route path="listings/new" element={<NewListingPage />} />
              <Route path="listings/:id" element={<ListingDetailPage />} />
              <Route path="seeking" element={<SeekingPage />} />
              <Route path="buildings" element={<BuildingsPage />} />
              <Route path="buildings/:id" element={<BuildingDetailPage />} />
              <Route path="profile" element={<ProfilePage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
