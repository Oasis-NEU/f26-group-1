import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AuthContext } from '../lib/auth'
import { supabase } from '../lib/supabase'
import type { Tables } from '../types/database'

type LoadedProfile = { userId: string; profile: Tables<'profiles'> | null }

async function fetchProfile(userId: string) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) console.error('Could not load profile:', error.message)
  return data
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // undefined until supabase-js has restored any saved session
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [loaded, setLoaded] = useState<LoadedProfile | null>(null)

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id

  // A saved session can outlive its user (e.g. deleted in the dashboard); the JWT
  // still passes RLS but inserts hit foreign keys. Ask the server and drop it.
  useEffect(() => {
    if (!userId) return
    supabase.auth.getUser().then(({ error }) => {
      if (error && (error.code === 'user_not_found' || error.status === 403)) supabase.auth.signOut()
    })
  }, [userId])

  useEffect(() => {
    if (!userId) return
    let active = true
    fetchProfile(userId).then((profile) => active && setLoaded({ userId, profile }))
    return () => {
      active = false
    }
  }, [userId])

  // Called after onboarding/profile edits so the app sees the new row.
  const refreshProfile = useCallback(async () => {
    if (userId) setLoaded({ userId, profile: await fetchProfile(userId) })
  }, [userId])

  const value = useMemo(() => {
    const profileLoaded = !userId || loaded?.userId === userId
    return {
      session: session ?? null,
      profile: profileLoaded ? (loaded?.profile ?? null) : null,
      loading: session === undefined || !profileLoaded,
      refreshProfile,
    }
  }, [session, userId, loaded, refreshProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
