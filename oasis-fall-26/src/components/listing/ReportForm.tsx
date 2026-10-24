import { useState, type FormEvent } from 'react'
import { useAuth } from '../../lib/auth'
import { REPORT_REASONS } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { Enums } from '../../types/database'
import { Button, Card, ErrorMessage, Field, Select, Textarea } from '../ui'

export function ReportForm({ listingId }: { listingId: number }) {
  const { session } = useAuth()
  const [reason, setReason] = useState<Enums<'report_reason'>>('out_of_date')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    // Insert only: reports aren't readable by users, so no .select() here.
    const { error } = await supabase
      .from('reports')
      .insert({ listing_id: listingId, reporter_id: session!.user.id, reason, note: note.trim() || null })
    setBusy(false)
    if (!error) setDone('Thanks. The team will take a look.')
    else if (error.code === '23505') setDone('You’ve already reported this listing.')
    else setError(error.message)
  }

  if (done) {
    return (
      <Card>
        <p className="text-sm text-slate-700">{done}</p>
      </Card>
    )
  }

  return (
    <Card>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-slate-700">Report this listing</summary>
        <form onSubmit={submit} className="mt-3 space-y-3">
          <Field label="What’s wrong?">
            <Select value={reason} onChange={(e) => setReason(e.target.value as Enums<'report_reason'>)}>
              {Object.entries(REPORT_REASONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Details (optional)">
            <Textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <ErrorMessage error={error} />
          <Button type="submit" variant="secondary" disabled={busy}>
            {busy ? 'Sending…' : 'Send report'}
          </Button>
        </form>
      </details>
    </Card>
  )
}
