import { useCallback, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ListingCard } from '../components/ListingCard'
import { Card, ErrorMessage, Loading } from '../components/ui'
import { formatDate } from '../lib/format'
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

export function BuildingDetailPage() {
  const id = Number(useParams().id)

  const load = useCallback(async () => {
    const [building, listings] = await Promise.all([
      supabase.from('buildings').select('*').eq('id', id).maybeSingle(),
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

  return (
    <div className="space-y-6">
      <Link to="/buildings" className="text-sm text-slate-600 hover:text-slate-900">
        ← All buildings
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{building.name}</h1>
        <p className="mt-1 text-slate-600">{building.neighborhood}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          {building.summary && (
            <Card>
              <h2 className="font-semibold">What students say</h2>
              <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{building.summary}</p>
              <p className="mt-3 text-xs text-slate-500">Last updated {formatDate(building.updated_at)}</p>
            </Card>
          )}
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
            <Fact label="Typical rent">{building.rent_range}</Fact>
            <Fact label="Management">{building.management_company}</Fact>
            <Fact label="Laundry">{building.laundry}</Fact>
            <Fact label="Heat / AC">{building.heat_ac}</Fact>
            <Fact label="Amenities">{building.amenities.join(', ')}</Fact>
          </dl>
        </Card>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Open rooms in this building</h2>
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

function Fact({ label, children }: { label: string; children: ReactNode }) {
  if (!children) return null
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  )
}
