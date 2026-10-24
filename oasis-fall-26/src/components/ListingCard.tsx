import { Link } from 'react-router'
import { formatDates, formatRent } from '../lib/format'
import type { ListingSummary } from '../lib/listings'
import { Badge } from './ui'

export function ListingCard({ listing, score }: { listing: ListingSummary; score?: number }) {
  return (
    <Link
      to={`/listings/${listing.id}`}
      className="block rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-red-300 hover:shadow"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold">{listing.title}</h3>
        {score !== undefined ? (
          <Badge tone="green">Score {score}</Badge>
        ) : (
          listing.status !== 'open' && <Badge>{listing.status}</Badge>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {listing.neighborhood}
        {listing.buildings && ` · ${listing.buildings.name}`}
      </p>
      <p className="mt-3 text-sm">{formatDates(listing.start_date, listing.end_date)}</p>
      <p className="mt-1 text-sm text-slate-600">
        {formatRent(listing.rent_per_room)} per room · {listing.open_rooms} of {listing.total_bedrooms}{' '}
        rooms open
      </p>
    </Link>
  )
}
