import { useCallback, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { MatchingSeekers } from '../components/listing/MatchingSeekers'
import { PhotosSection } from '../components/listing/PhotosSection'
import { ReportForm } from '../components/listing/ReportForm'
import { RoommatesSection } from '../components/listing/RoommatesSection'
import { StatusControls } from '../components/listing/StatusControls'
import { Badge, Card, ErrorMessage, Loading } from '../components/ui'
import { useAuth } from '../lib/auth'
import { formatDate, formatDates, formatRent } from '../lib/format'
import { signPhotos } from '../lib/photos'
import { must, supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

const DETAIL =
  '*, buildings(id, name), profiles(full_name, year, major), listing_roommates(id, display_name, note), listing_photos(id, path, position)'

export function ListingDetailPage() {
  const id = Number(useParams().id)
  const { session } = useAuth()

  const load = useCallback(async () => {
    const listing = must(await supabase.from('listings').select(DETAIL).eq('id', id).maybeSingle())
    if (!listing) return null
    return { ...listing, photos: await signPhotos(listing.listing_photos) }
  }, [id])
  const { data: listing, loading, error, reload } = useAsync(load)

  if (loading) return <Loading />
  if (error) return <ErrorMessage error={error} />
  if (!listing) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Listing not found</h1>
        <p className="text-sm text-slate-600">It may have been filled or closed.</p>
        <Link to="/" className="text-sm text-red-700 underline">
          Back to listings
        </Link>
      </div>
    )
  }

  const isOwner = listing.owner_id === session!.user.id

  return (
    <div className="space-y-6">
      <Link to="/" className="text-sm text-slate-600 hover:text-slate-900">
        ← All listings
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{listing.title}</h1>
          <p className="mt-1 text-slate-600">
            {listing.neighborhood}
            {listing.buildings && (
              <>
                {' · '}
                <Link to={`/buildings/${listing.buildings.id}`} className="underline hover:text-slate-900">
                  {listing.buildings.name}
                </Link>
              </>
            )}
          </p>
        </div>
        <Badge tone={listing.status === 'open' ? 'green' : 'slate'}>{listing.status}</Badge>
      </div>

      <PhotosSection
        listingId={listing.id}
        ownerId={listing.owner_id}
        photos={listing.photos}
        isOwner={isOwner}
        onChange={reload}
      />

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          <Card>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <Fact label="Dates">{formatDates(listing.start_date, listing.end_date)}</Fact>
              <Fact label="Rent">{formatRent(listing.rent_per_room)} per room</Fact>
              <Fact label="Rooms">
                {listing.open_rooms} of {listing.total_bedrooms} open
              </Fact>
              <Fact label="Fill by">{formatDate(listing.fill_by)}</Fact>
              <Fact label="Utilities">{listing.utilities_included ? 'Included' : 'Not included'}</Fact>
              <Fact label="Furnished">{listing.furnished ? 'Yes' : 'No'}</Fact>
            </dl>
            {listing.description && (
              <p className="mt-4 whitespace-pre-line text-sm text-slate-700">{listing.description}</p>
            )}
          </Card>
          <RoommatesSection
            listingId={listing.id}
            roommates={listing.listing_roommates}
            isOwner={isOwner}
            onChange={reload}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="text-sm font-medium text-slate-500">Listed by</h2>
            <p className="mt-1 font-semibold">{listing.profiles.full_name}</p>
            <p className="text-sm text-slate-600">
              {[listing.profiles.year, listing.profiles.major].filter(Boolean).join(' · ')}
            </p>
          </Card>
          {isOwner ? <StatusControls listing={listing} onChange={reload} /> : <ReportForm listingId={listing.id} />}
        </div>
      </div>

      {isOwner && listing.status === 'open' && <MatchingSeekers listingId={listing.id} />}
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  )
}
