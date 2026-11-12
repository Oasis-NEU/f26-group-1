import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { MapBuilding } from '../components/BuildingsMap'
import { Badge, ErrorMessage, Loading, PageTitle } from '../components/ui'
import { must, supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

// Leaflet is only needed here, so it loads in its own chunk.
const BuildingsMap = lazy(() => import('../components/BuildingsMap'))

// The building database: off-campus buildings near Northeastern, useful on its own
// (look a building up before signing) and linked to any open sublets inside it.
// List on the left, map with a pin per building on the right (stacked on phones).
export function BuildingsPage() {
  const load = useCallback(
    async () =>
      must(
        await supabase
          .from('buildings')
          .select('id, name, neighborhood, address, walk_minutes_to_campus, rent_range, latitude, longitude, listings(count)')
          .eq('listings.status', 'open')
          .order('name'),
      ),
    [],
  )
  const { data, loading, error } = useAsync(load)

  const buildings = useMemo(
    () => (data ?? []).map((b) => ({ ...b, openCount: b.listings[0]?.count ?? 0 })),
    [data],
  )
  // Only buildings with coordinates get a pin.
  const pins = useMemo(
    () =>
      buildings.flatMap((b): MapBuilding[] =>
        b.latitude !== null && b.longitude !== null
          ? [{ id: b.id, name: b.name, neighborhood: b.neighborhood, latitude: b.latitude, longitude: b.longitude, openCount: b.openCount }]
          : [],
      ),
    [buildings],
  )

  // Highlighted building: set by clicking a pin (scrolls its card into view) or hovering a card.
  const [activeId, setActiveId] = useState<number | null>(null)

  function selectFromMap(id: number) {
    setActiveId(id)
    document.getElementById(`building-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  return (
    <div>
      <PageTitle>Buildings</PageTitle>
      <p className="mb-6 text-sm text-slate-600">
        Off-campus buildings near Northeastern. Look one up before you sign, and see any rooms open there now.
      </p>
      {loading && <Loading />}
      <ErrorMessage error={error} />
      {data?.length === 0 && <p className="text-sm text-slate-600">No buildings yet.</p>}

      {data && data.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="order-2 space-y-4 lg:order-1">
            {buildings.map((b) => (
              <Link
                key={b.id}
                id={`building-${b.id}`}
                to={`/buildings/${b.id}`}
                onMouseEnter={() => setActiveId(b.id)}
                onFocus={() => setActiveId(b.id)}
                className={`block scroll-mt-4 rounded-lg border bg-white p-5 shadow-sm transition hover:border-red-300 hover:shadow ${
                  b.id === activeId ? 'border-red-400 ring-1 ring-red-400' : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-semibold">{b.name}</h2>
                  {b.openCount > 0 && (
                    <Badge tone="green">
                      {b.openCount} open {b.openCount === 1 ? 'sublet' : 'sublets'}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-600">{b.neighborhood}</p>
                {b.address && <p className="mt-0.5 text-sm text-slate-500">{b.address}</p>}
                <p className="mt-3 text-sm text-slate-700">
                  {[b.walk_minutes_to_campus !== null && `${b.walk_minutes_to_campus} min walk`, b.rent_range]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {b.latitude === null && <p className="mt-2 text-xs text-slate-400">Not on the map yet</p>}
              </Link>
            ))}
          </div>

          <div className="order-1 lg:order-2">
            <div className="isolate h-72 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-sm lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
              <Suspense fallback={<div className="p-4"><Loading /></div>}>
                <BuildingsMap buildings={pins} selectedId={activeId} onSelect={selectFromMap} />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
