import { useState } from 'react'
import { supabase } from './supabaseClient'
import './Auth.css'

export default function Auth() {
  const [mode, setMode] = useState('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  const isSignUp = mode === 'signUp'

  const handleSubmit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) {
        setError(error.message)
      } else if (!data.session) {
        // Email confirmation is enabled, so no session until the link is clicked
        setMessage('Check your email for a confirmation link.')
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) setError(error.message)
    }

    setLoading(false)
  }

  const switchMode = () => {
    setMode(isSignUp ? 'signIn' : 'signUp')
    setError(null)
    setMessage(null)
  }

  return (
    <section className="auth">
      <h1>{isSignUp ? 'Create an account' : 'Sign in'}</h1>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            required
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            required
            minLength={6}
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="auth-error">{error}</p>}
        {message && <p className="auth-message">{message}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Loading…' : isSignUp ? 'Sign up' : 'Sign in'}
        </button>
      </form>
      <p>
        {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
        <button type="button" className="auth-link" onClick={switchMode}>
          {isSignUp ? 'Sign in' : 'Sign up'}
        </button>
      </p>
    </section>
  )
}
