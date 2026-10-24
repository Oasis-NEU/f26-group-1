import type { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'
import type { Tables } from '../types/database'

export type AuthState = {
  session: Session | null
  // null until the user finishes onboarding
  profile: Tables<'profiles'> | null
  loading: boolean
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>')
  return auth
}
