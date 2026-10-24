import { useState, type FormEvent } from 'react'
import { NEIGHBORHOODS, SEEKER_REASONS } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { Enums } from '../../types/database'
import { Button, Card, Checkbox, ErrorMessage, Field, Input, Select, Textarea } from '../ui'

export function SeekerPostForm({ userId, onCreated }: { userId: string; onCreated: () => void }) {
  const [form, setForm] = useState({
    start_date: '',
    end_date: '',
    reason: 'co_op' as Enums<'seeker_reason'>,
    budget_max: '',
    neighborhoods: [] as string[],
    note: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleNeighborhood(name: string) {
    setForm((f) => ({
      ...f,
      neighborhoods: f.neighborhoods.includes(name)
        ? f.neighborhoods.filter((n) => n !== name)
        : [...f.neighborhoods, name],
    }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (form.end_date <= form.start_date) return setError('The end date must be after the start date.')
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('seeker_posts').insert({
      user_id: userId,
      start_date: form.start_date,
      end_date: form.end_date,
      reason: form.reason,
      budget_max: Number(form.budget_max),
      neighborhoods: form.neighborhoods,
      note: form.note.trim() || null,
    })
    setBusy(false)
    if (error) setError(error.message)
    else onCreated()
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="font-semibold">What do you need?</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From">
            <Input
              type="date"
              required
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            />
          </Field>
          <Field label="Until">
            <Input
              type="date"
              required
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            />
          </Field>
          <Field label="Reason">
            <Select
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value as Enums<'seeker_reason'> })}
            >
              {Object.entries(SEEKER_REASONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Max rent ($/mo)">
            <Input
              type="number"
              required
              min={1}
              step={1}
              value={form.budget_max}
              onChange={(e) => setForm({ ...form, budget_max: e.target.value })}
            />
          </Field>
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Neighborhoods</legend>
          <p className="text-xs text-slate-500">Leave all unchecked for anywhere.</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {NEIGHBORHOODS.map((n) => (
              <Checkbox
                key={n}
                label={n}
                checked={form.neighborhoods.includes(n)}
                onChange={() => toggleNeighborhood(n)}
              />
            ))}
          </div>
        </fieldset>
        <Field label="Anything else? (optional)" hint={`${form.note.length}/1000`}>
          <Textarea
            rows={3}
            maxLength={1000}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </Field>
        <ErrorMessage error={error} />
        <Button type="submit" disabled={busy}>
          {busy ? 'Posting…' : 'Post'}
        </Button>
      </form>
    </Card>
  )
}
