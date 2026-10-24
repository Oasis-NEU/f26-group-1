import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Enums, Tables } from '../../types/database'
import { Button, Card, ErrorMessage } from '../ui'

type Props = {
  listing: Pick<Tables<'listings'>, 'id' | 'status'>
  onChange: () => void
}

export function StatusControls({ listing, onChange }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function setStatus(status: Enums<'listing_status'>) {
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('listings').update({ status }).eq('id', listing.id)
    setBusy(false)
    if (error) setError(error.message)
    else onChange()
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Manage listing</h2>
      <p className="text-sm text-slate-600">
        {listing.status === 'open'
          ? 'Found someone? Mark it filled so it stops showing up for seekers.'
          : 'This listing is hidden from other students.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {listing.status === 'open' ? (
          <>
            <Button disabled={busy} onClick={() => setStatus('filled')}>
              Mark filled
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setStatus('closed')}>
              Close
            </Button>
          </>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => setStatus('open')}>
            Reopen
          </Button>
        )}
      </div>
      <ErrorMessage error={error} />
    </Card>
  )
}
