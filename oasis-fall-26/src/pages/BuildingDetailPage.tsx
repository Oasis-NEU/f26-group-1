import { useCallback, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ListingCard } from '../components/ListingCard'
import { Card, ErrorMessage, Loading } from '../components/ui'
import { compareHref } from '../lib/compare'
import { formatDate, formatRent } from '../lib/format'
import { LISTING_SUMMARY } from '../lib/listings'
import { must, supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'
import type { Json } from '../types/database'

// sources is jsonb: [{ "title": "...", "url": "..." }]. Only http(s) links are shown.
function parseSources(sources: Json) {
  if (!Array.isArray(sources)) return []
  return sources.flatMap((s) =>
    s && typeof s === 'object' && !Array.isArray(s) && typeof s.title === 'string' && typeof s.url === 'string'
      ? /^https?:\/\//.test(s.url)
        ? [{ title: s.title, url: s.url }]
        : []
      : [],
  )
}

// Basic building template: only the core facts every building has. Feature fields
// (laundry, heat_ac, amenities) stay in the database but aren't shown until the team
// decides which features to track (see "Building database plan" in CLAUDE.md).
// slug + building_specs decide whether the Compare button shows.
const BUILDING_BASICS =
  'id, slug, name, neighborhood, address, management_company, walk_minutes_to_campus, rent_range, summary, sources, updated_at, building_specs(building_id)'

export function BuildingDetailPage() {
  const id = Number(useParams().id)

  const load = useCallback(async () => {
    const [building, listings] = await Promise.all([
      supabase.from('buildings').select(BUILDING_BASICS).eq('id', id).maybeSingle(),
      supabase.from('listings').select(LISTING_SUMMARY).eq('building_id', id).eq('status', 'open').order('start_date'),
    ])
    return { building: must(building), listings: must(listings) }
  }, [id])
  const { data, loading, error } = useAsync(load)

  if (loading) return <Loading />
  if (error) return <ErrorMessage error={error} />
  if (!data?.building) return <p className="text-sm text-slate-600">Building not found.</p>

  const { building, listings } = data
  const sources = parseSources(building.sources)
  // Live rent from this building's open sublets, shown alongside the scraped range.
  const rents = listings.map((l) => l.rent_per_room)
  const subletRent =
    rents.length === 0
      ? null
      : Math.min(...rents) === Math.max(...rents)
        ? `${formatRent(rents[0])}/room`
        : `${formatRent(Math.min(...rents))}–${formatRent(Math.max(...rents))}/room`

  return (
    <div className="space-y-6">
      <Link to="/buildings" className="text-sm text-slate-600 hover:text-slate-900">
        ← All buildings
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{building.name}</h1>
          <p className="mt-1 text-slate-600">{building.neighborhood}</p>
          {building.address && <p className="mt-0.5 text-sm text-slate-500">{building.address}</p>}
        </div>
        {building.slug && building.building_specs && (
          <Link
            to={compareHref([building.slug])}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Compare with other buildings
          </Link>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          <Card>
            <h2 className="font-semibold">Overview</h2>
            {building.summary ? (
              <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{building.summary}</p>
            ) : (
              <p className="mt-2 text-sm text-slate-500">No overview yet.</p>
            )}
          </Card>
          {sources.length > 0 && (
            <Card>
              <h2 className="font-semibold">Sources</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-red-700 underline">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <Card>
          <dl className="space-y-3 text-sm">
            <Fact label="Walk to campus">
              {building.walk_minutes_to_campus !== null && `${building.walk_minutes_to_campus} min`}
            </Fact>
            <Fact label="Address">{building.address}</Fact>
            <Fact label="Typical rent">{building.rent_range}</Fact>
            {subletRent && <Fact label="Sublets here now">{subletRent}</Fact>}
            <Fact label="Management">{building.management_company}</Fact>
          </dl>
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            Info gathered from public sources. Last updated {formatDate(building.updated_at)}.
          </p>
        </Card>
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Open sublets in this building</h2>
          <Link to={`/listings/new?building=${building.id}`} className="text-sm text-red-700 underline">
            Subletting here? List your room
          </Link>
        </div>
        {listings.length === 0 ? (
          <p className="text-sm text-slate-600">None right now.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// Every basic fact always shows, so all building pages share one layout.
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium">{children || <span className="font-normal text-slate-400">Not available yet</span>}</dd>
    </div>
  )
}
