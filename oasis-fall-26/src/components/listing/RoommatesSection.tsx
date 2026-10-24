import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { Tables } from '../../types/database'
import { Button, Card, ErrorMessage, Field, Input } from '../ui'

type Props = {
  listingId: number
  roommates: Pick<Tables<'listing_roommates'>, 'id' | 'display_name' | 'note'>[]
  isOwner: boolean
  onChange: () => void
}

export function RoommatesSection({ listingId, roommates, isOwner, onChange }: Props) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function add(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const { error } = await supabase
      .from('listing_roommates')
      .insert({ listing_id: listingId, display_name: name.trim(), note: note.trim() || null })
    if (error) return setError(error.message)
    setName('')
    setNote('')
    onChange()
  }

  async function remove(id: number) {
    setError(null)
    const { error } = await supabase.from('listing_roommates').delete().eq('id', id)
    if (error) setError(error.message)
    else onChange()
  }

  if (roommates.length === 0 && !isOwner) return null

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Roommates staying</h2>
      {roommates.length === 0 ? (
        <p className="text-sm text-slate-600">None listed.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {roommates.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div>
                <p className="font-medium">{r.display_name}</p>
                {r.note && <p className="text-slate-600">{r.note}</p>}
              </div>
              {isOwner && (
                <button type="button" onClick={() => remove(r.id)} className="text-xs text-slate-500 hover:text-red-700">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isOwner && (
        <form onSubmit={add} className="space-y-3 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500">Get your roommates’ OK before listing them.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Note (optional)">
              <Input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" variant="secondary">
            Add roommate
          </Button>
        </form>
      )}
      <ErrorMessage error={error} />
    </Card>
  )
}
