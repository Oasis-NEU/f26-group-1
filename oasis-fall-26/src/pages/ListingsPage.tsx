import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import { ListingCard } from '../components/ListingCard'
import { Button, Card, Checkbox, ErrorMessage, Field, Input, Loading, PageTitle, Select } from '../components/ui'
import { useAuth } from '../lib/auth'
import { formatRent, NEIGHBORHOODS } from '../lib/format'
import { LISTING_SUMMARY, type ListingSummary } from '../lib/listings'
import { must, supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

type Filters = {
  neighborhood: string
  startDate: string
  endDate: string
  maxRent: number | null // null = no limit
  minOpenRooms: number // 0 = any
  utilitiesIncluded: boolean
  furnished: boolean
}

const NO_FILTERS: Filters = {
  neighborhood: '',
  startDate: '',
  endDate: '',
  maxRent: null,
  minOpenRooms: 0,
  utilitiesIncluded: false,
  furnished: false,
}

const RENT_STEP = 50

// Dates are 'YYYY-MM-DD', so string comparison orders them correctly.
// Date filters keep any listing that overlaps the chosen range by at least a day.
function matchesFilters(listing: ListingSummary, f: Filters) {
  return (
    (!f.neighborhood || listing.neighborhood === f.neighborhood) &&
    (!f.startDate || listing.end_date > f.startDate) &&
    (!f.endDate || listing.start_date < f.endDate) &&
    (f.maxRent === null || listing.rent_per_room <= f.maxRent) &&
    listing.open_rooms >= f.minOpenRooms &&
    (!f.utilitiesIncluded || listing.utilities_included) &&
    (!f.furnished || listing.furnished)
  )
}

export function ListingsPage() {
  const { session } = useAuth()
  const userId = session!.user.id
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }))
  const filtering = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS)

  // RLS returns open listings plus the user's own (in any status).
  const load = useCallback(
    async () => must(await supabase.from('listings').select(LISTING_SUMMARY).order('start_date')),
    [],
  )
  const { data: listings, loading, error } = useAsync(load)

  const mine = listings?.filter((l) => l.owner_id === userId) ?? []
  const open = listings?.filter((l) => l.owner_id !== userId) ?? []
  const others = open.filter((l) => matchesFilters(l, filters))
  // The slider tops out at the priciest open room; dragging all the way right means no limit.
  const rentCeiling = Math.max(
    RENT_STEP,
    Math.ceil(Math.max(0, ...open.map((l) => l.rent_per_room)) / RENT_STEP) * RENT_STEP,
  )

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
          <h2 className="mb-3 text-lg font-semibold">Open rooms</h2>
          <Card className="mb-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Neighborhood">
                <Select value={filters.neighborhood} onChange={(e) => setFilter('neighborhood', e.target.value)}>
                  <option value="">All</option>
                  {NEIGHBORHOODS.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Start date" hint="Available after this date">
                <Input
                  type="date"
                  value={filters.startDate}
                  max={filters.endDate || undefined}
                  onChange={(e) => setFilter('startDate', e.target.value)}
                />
              </Field>
              <Field label="End date" hint="Available before this date">
                <Input
                  type="date"
                  value={filters.endDate}
                  min={filters.startDate || undefined}
                  onChange={(e) => setFilter('endDate', e.target.value)}
                />
              </Field>
              <Field label="Open rooms">
                <Select
                  value={filters.minOpenRooms}
                  onChange={(e) => setFilter('minOpenRooms', Number(e.target.value))}
                >
                  <option value={0}>Any</option>
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}+
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-4">
              <Field label={`Max rent: ${filters.maxRent === null ? 'Any' : formatRent(filters.maxRent)}`}>
                <input
                  type="range"
                  min={0}
                  max={rentCeiling}
                  step={RENT_STEP}
                  value={filters.maxRent ?? rentCeiling}
                  onChange={(e) => {
                    const value = Number(e.target.value)
                    setFilter('maxRent', value >= rentCeiling ? null : value)
                  }}
                  className="block w-full accent-red-700"
                />
              </Field>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-6">
                <Checkbox
                  label="Utilities included"
                  checked={filters.utilitiesIncluded}
                  onChange={(e) => setFilter('utilitiesIncluded', e.target.checked)}
                />
                <Checkbox
                  label="Furnished"
                  checked={filters.furnished}
                  onChange={(e) => setFilter('furnished', e.target.checked)}
                />
              </div>
              <Button variant="secondary" disabled={!filtering} onClick={() => setFilters(NO_FILTERS)}>
                Clear filters
              </Button>
            </div>
          </Card>
          {others.length === 0 ? (
            <p className="text-sm text-slate-600">
              {filtering ? 'No open rooms match these filters.' : 'No open rooms right now.'}
            </p>
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
