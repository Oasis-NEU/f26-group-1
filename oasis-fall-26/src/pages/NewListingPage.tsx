import { useNavigate, useSearchParams } from 'react-router'
import { ListingForm } from '../components/listing/ListingForm'
import { EMPTY_LISTING_FORM, type ListingFields } from '../lib/listingForm'
import { Card, PageTitle } from '../components/ui'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

export function NewListingPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  // Building pages link here with ?building=<id> to preselect it.
  const building = useSearchParams()[0].get('building')
  const initial = { ...EMPTY_LISTING_FORM, building_id: building && /^\d+$/.test(building) ? building : '' }

  async function create(fields: ListingFields) {
    const { data, error } = await supabase
      .from('listings')
      .insert({ ...fields, owner_id: session!.user.id })
      .select('id')
      .single()
    if (error) return error.message
    navigate(`/listings/${data.id}`)
    return null
  }

  return (
    <div className="max-w-2xl">
      <PageTitle>List a room</PageTitle>
      <Card>
        <ListingForm
          initial={initial}
          submitLabel="Post listing"
          busyLabel="Posting…"
          onSubmit={create}
          footer={<p className="text-xs text-slate-500">You can add photos and roommates on the next page.</p>}
        />
      </Card>
    </div>
  )
}
