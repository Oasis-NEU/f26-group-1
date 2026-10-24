import { useCallback, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Button, Card, ErrorMessage, Field, Input, Loading, PageTitle, Select, Textarea } from '../components/ui'
import { useAuth } from '../lib/auth'
import { must, supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'
import type { Tables } from '../types/database'

// Doubles as onboarding: users without a profile row land here after first login.
export function ProfilePage() {
  const { session, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const userId = session!.user.id
  const onboarding = !profile

  const [form, setForm] = useState({
    full_name: profile?.full_name ?? '',
    email: profile?.email ?? '',
    year: profile?.year ?? '',
    major: profile?.major ?? '',
    bio: profile?.bio ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    const { error } = await supabase.from('profiles').upsert({
      id: userId,
      full_name: form.full_name.trim(),
      email: form.email.trim().toLowerCase(),
      year: form.year.trim() || null,
      major: form.major.trim() || null,
      bio: form.bio.trim() || null,
    })
    setBusy(false)
    if (error) return setError(error.message)
    await refreshProfile()
    if (onboarding) navigate('/')
    else setSaved(true)
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageTitle>{onboarding ? 'Welcome! Tell us about yourself' : 'Your profile'}</PageTitle>
      <Card>
        <form onSubmit={save} className="space-y-4">
          <Field label="Full name">
            <Input
              required
              maxLength={100}
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </Field>
          <Field label="Northeastern email" hint="Not verified yet">
            <Input
              type="email"
              required
              autoComplete="email"
              pattern=".+@northeastern\.edu"
              title="Use your @northeastern.edu email"
              maxLength={254}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Year" hint="e.g. 3rd year, Grad">
              <Input maxLength={30} value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
            </Field>
            <Field label="Major">
              <Input maxLength={100} value={form.major} onChange={(e) => setForm({ ...form, major: e.target.value })} />
            </Field>
          </div>
          <Field label="Short bio" hint={`${form.bio.length}/500`}>
            <Textarea maxLength={500} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          </Field>
          <ErrorMessage error={error} />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : onboarding ? 'Continue' : 'Save profile'}
            </Button>
            {saved && <span className="text-sm text-emerald-700">Saved</span>}
          </div>
        </form>
      </Card>
      {!onboarding && <Lifestyle userId={userId} />}
    </div>
  )
}

function Lifestyle({ userId }: { userId: string }) {
  const load = useCallback(
    async () => must(await supabase.from('lifestyle').select('*').eq('user_id', userId).maybeSingle()),
    [userId],
  )
  const { data, loading, error } = useAsync(load)

  if (loading) return <Loading />
  if (error) return <ErrorMessage error={error} />
  return <LifestyleForm userId={userId} initial={data ?? null} />
}

const scales = [
  { key: 'sleep', label: 'Sleep schedule', low: 'Early bird', high: 'Night owl' },
  { key: 'cleanliness', label: 'Cleanliness', low: 'Relaxed', high: 'Very tidy' },
  { key: 'guests', label: 'Guests over', low: 'Rarely', high: 'Often' },
  { key: 'noise', label: 'Noise level', low: 'Quiet', high: 'Loud' },
] as const

type ScaleKey = (typeof scales)[number]['key']

// '' = prefer not to say (stored as null)
const toField = (v: number | boolean | null | undefined) => (v === null || v === undefined ? '' : String(v))
const toNumber = (v: string) => (v === '' ? null : Number(v))
const toBoolean = (v: string) => (v === '' ? null : v === 'true')

function LifestyleForm({ userId, initial }: { userId: string; initial: Tables<'lifestyle'> | null }) {
  const [form, setForm] = useState({
    sleep: toField(initial?.sleep),
    cleanliness: toField(initial?.cleanliness),
    guests: toField(initial?.guests),
    noise: toField(initial?.noise),
    smokes: toField(initial?.smokes),
    has_pets: toField(initial?.has_pets),
    dealbreakers: initial?.dealbreakers.join(', ') ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    const { error } = await supabase.from('lifestyle').upsert({
      user_id: userId,
      sleep: toNumber(form.sleep),
      cleanliness: toNumber(form.cleanliness),
      guests: toNumber(form.guests),
      noise: toNumber(form.noise),
      smokes: toBoolean(form.smokes),
      has_pets: toBoolean(form.has_pets),
      dealbreakers: form.dealbreakers
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean),
    })
    setBusy(false)
    if (error) setError(error.message)
    else setSaved(true)
  }

  return (
    <Card>
      <h2 className="font-semibold">Lifestyle (optional)</h2>
      <p className="mt-1 text-sm text-slate-600">Helps future roommates get a sense of you.</p>
      <form onSubmit={save} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {scales.map((scale) => (
            <Field key={scale.key} label={scale.label} hint={`1 = ${scale.low}, 5 = ${scale.high}`}>
              <Select
                value={form[scale.key as ScaleKey]}
                onChange={(e) => setForm({ ...form, [scale.key]: e.target.value })}
              >
                <option value="">Prefer not to say</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
          <Field label="Do you smoke?">
            <Select value={form.smokes} onChange={(e) => setForm({ ...form, smokes: e.target.value })}>
              <option value="">Prefer not to say</option>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </Select>
          </Field>
          <Field label="Do you have pets?">
            <Select value={form.has_pets} onChange={(e) => setForm({ ...form, has_pets: e.target.value })}>
              <option value="">Prefer not to say</option>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </Select>
          </Field>
        </div>
        <Field label="Dealbreakers" hint="Comma-separated, e.g. smoking, pets">
          <Input value={form.dealbreakers} onChange={(e) => setForm({ ...form, dealbreakers: e.target.value })} />
        </Field>
        <ErrorMessage error={error} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save lifestyle'}
          </Button>
          {saved && <span className="text-sm text-emerald-700">Saved</span>}
        </div>
      </form>
    </Card>
  )
}
