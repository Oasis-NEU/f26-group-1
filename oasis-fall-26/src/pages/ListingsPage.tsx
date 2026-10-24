import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import { ListingCard } from '../components/ListingCard'
import { ErrorMessage, Field, Loading, PageTitle, Select } from '../components/ui'
import { useAuth } from '../lib/auth'
import { NEIGHBORHOODS } from '../lib/format'
import { LISTING_SUMMARY } from '../lib/listings'
import { must, supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

export function ListingsPage() {
  const { session } = useAuth()
  const userId = session!.user.id
  const [neighborhood, setNeighborhood] = useState('')

  // RLS returns open listings plus the user's own (in any status).
  const load = useCallback(
    async () => must(await supabase.from('listings').select(LISTING_SUMMARY).order('start_date')),
    [],
  )
  const { data: listings, loading, error } = useAsync(load)

  const mine = listings?.filter((l) => l.owner_id === userId) ?? []
  const others =
    listings?.filter((l) => l.owner_id !== userId && (!neighborhood || l.neighborhood === neighborhood)) ?? []

  return (
    <div className="space-y-8">
      <PageTitle
        action={
          <Link
            to="/listings/new"
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800"
          >
            List a room
          </Link>
        }
      >
        Listings
      </PageTitle>

      {loading && <Loading />}
      <ErrorMessage error={error} />

      {mine.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Your listings</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {mine.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        </section>
      )}

      {listings && (
        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-semibold">Open rooms</h2>
            <div className="w-56">
              <Field label="Neighborhood">
                <Select value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)}>
                  <option value="">All</option>
                  {NEIGHBORHOODS.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
          {others.length === 0 ? (
            <p className="text-sm text-slate-600">No open rooms right now.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {others.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
