import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

const links = [
  { to: '/', label: 'Listings', end: true },
  { to: '/seeking', label: 'Looking for a room', end: false },
  { to: '/buildings', label: 'Buildings', end: false },
  { to: '/profile', label: 'Profile', end: false },
]

export function Layout() {
  const { profile } = useAuth()

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <NavLink to="/" className="text-lg font-bold text-red-700">
            NUSublet
          </NavLink>
          {/* Hidden during onboarding so new users finish their profile first. */}
          {profile && (
            <nav className="flex flex-wrap gap-4 text-sm">
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    isActive ? 'font-semibold text-slate-900' : 'text-slate-600 hover:text-slate-900'
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
          )}
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="ml-auto text-sm text-slate-600 hover:text-slate-900"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
