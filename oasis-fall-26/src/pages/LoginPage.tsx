import { useState } from 'react'
import { Navigate } from 'react-router'
import { Button, Card, ErrorMessage } from '../components/ui'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

// Temporary: anonymous sign-in while email delivery is unsolved. Each browser
// gets its own account; the email is collected (unverified) on the profile form.
// The magic-link / code version of this page is in git history.
export function LoginPage() {
  const { session, loading } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!loading && session) return <Navigate to="/" replace />

  async function signIn() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInAnonymously()
    setBusy(false)
    // On success the auth listener picks up the session and this page redirects.
    if (error) setError(error.message)
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-red-700">NUSublet</h1>
        <p className="mt-1 text-sm text-slate-600">Fill empty rooms, or find one whose dates line up.</p>
        <div className="mt-6 space-y-4">
          <ErrorMessage error={error} />
          <Button onClick={signIn} disabled={busy} className="w-full">
            {busy ? 'Signing in…' : 'Continue'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
