import { useCallback } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ListingForm } from '../components/listing/ListingForm'
import { listingToForm, type ListingFields } from '../lib/listingForm'
import { Card, ErrorMessage, Loading, PageTitle } from '../components/ui'
import { useAuth } from '../lib/auth'
import { must, supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

// Owners edit any detail of their listing after posting, including linking it to a
// building that was added to the database later. RLS rejects edits by anyone else.
export function EditListingPage() {
  const id = Number(useParams().id)
  const { session } = useAuth()
  const navigate = useNavigate()

  const load = useCallback(
    async () => must(await supabase.from('listings').select('*').eq('id', id).maybeSingle()),
    [id],
  )
  const { data: listing, loading, error } = useAsync(load)

  if (loading) return <Loading />
  if (error) return <ErrorMessage error={error} />
  if (!listing || listing.owner_id !== session!.user.id) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">You can’t edit this listing</h1>
        <p className="text-sm text-slate-600">Only the student who posted a listing can edit it.</p>
        <Link to="/" className="text-sm text-red-700 underline">
          Back to listings
        </Link>
      </div>
    )
  }

  async function save(fields: ListingFields) {
    const { data, error } = await supabase.from('listings').update(fields).eq('id', id).select('id')
    if (error) return error.message
    if (!data.length) return 'Couldn’t save: this listing may have been deleted.'
    navigate(`/listings/${id}`)
    return null
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Link to={`/listings/${id}`} className="text-sm text-slate-600 hover:text-slate-900">
        ← Back to listing
      </Link>
      <PageTitle>Edit listing</PageTitle>
      <Card>
        <ListingForm
          initial={listingToForm(listing)}
          submitLabel="Save changes"
          busyLabel="Saving…"
          minOpenRooms={listing.status === 'open' ? 1 : 0}
          onSubmit={save}
          footer={<p className="text-xs text-slate-500">Photos and roommates are managed on the listing page.</p>}
        />
      </Card>
    </div>
  )
}
