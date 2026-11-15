import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { MapBuilding } from '../components/BuildingsMap'
import { Badge, Button, Checkbox, ErrorMessage, Loading, PageTitle } from '../components/ui'
import { MAX_COMPARE, compareHref } from '../lib/compare'
import { must, supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

// Leaflet is only needed here, so it loads in its own chunk.
const BuildingsMap = lazy(() => import('../components/BuildingsMap'))

// The building database: off-campus buildings near Northeastern, useful on its own
// (look a building up before signing) and linked to any open sublets inside it.
// List on the left, map with a pin per building on the right (stacked on phones).
// Buildings with specs can be ticked for side-by-side comparison.
export function BuildingsPage() {
  const navigate = useNavigate()
  const load = useCallback(
    async () =>
      must(
        await supabase
          .from('buildings')
          .select(
            'id, slug, name, neighborhood, address, walk_minutes_to_campus, rent_range, latitude, longitude, listings(count), building_specs(building_id)',
          )
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

  // Slugs ticked for comparison, in the order they were picked.
  const [picked, setPicked] = useState<string[]>([])
  const pickedNames = picked.map((slug) => buildings.find((b) => b.slug === slug)?.name ?? slug)

  function toggle(slug: string, on: boolean) {
    setPicked((p) => (on ? [...p, slug].slice(0, MAX_COMPARE) : p.filter((s) => s !== slug)))
  }

  return (
    <div className={picked.length ? 'pb-24' : ''}>
      <PageTitle
        action={
          <Link to="/compare" className="text-sm text-red-700 underline">
            Compare buildings
          </Link>
        }
      >
        Buildings
      </PageTitle>
      <p className="mb-6 text-sm text-slate-600">What students say about the buildings near campus.</p>
      {loading && <Loading />}
      <ErrorMessage error={error} />
      {data?.length === 0 && <p className="text-sm text-slate-600">No buildings yet.</p>}

      {data && data.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="order-2 space-y-4 lg:order-1">
            {buildings.map((b) => {
              const comparable = b.slug !== null && b.building_specs !== null
              const checked = b.slug !== null && picked.includes(b.slug)
              return (
                <div
                  key={b.id}
                  id={`building-${b.id}`}
                  onMouseEnter={() => setActiveId(b.id)}
                  onFocus={() => setActiveId(b.id)}
                  className={`flex scroll-mt-4 flex-col rounded-lg border bg-white shadow-sm transition hover:border-red-300 hover:shadow ${
                    b.id === activeId ? 'border-red-400 ring-1 ring-red-400' : 'border-slate-200'
                  }`}
                >
                  <Link to={`/buildings/${b.id}`} className="block flex-1 p-5">
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
                  {comparable && (
                    <div className="border-t border-slate-100 px-5 py-2.5">
                      <Checkbox
                        label="Compare"
                        checked={checked}
                        disabled={!checked && picked.length >= MAX_COMPARE}
                        onChange={(e) => toggle(b.slug!, e.target.checked)}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="order-1 lg:order-2">
            {/* Shorter while the compare bar is showing so the bar doesn't cover the map's bottom edge. */}
            <div
              className={`isolate h-72 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-sm lg:sticky lg:top-6 ${
                picked.length ? 'lg:h-[calc(100vh-9rem)]' : 'lg:h-[calc(100vh-3rem)]'
              }`}
            >
              <Suspense fallback={<div className="p-4"><Loading /></div>}>
                <BuildingsMap buildings={pins} selectedId={activeId} onSelect={selectFromMap} />
              </Suspense>
            </div>
          </div>
        </div>
      )}

      {picked.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 shadow-lg backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
            <p className="min-w-0 flex-1 truncate text-sm text-slate-700">
              <span className="font-semibold">{picked.length} selected</span>
              <span className="hidden sm:inline"> · {pickedNames.join(', ')}</span>
              {picked.length >= MAX_COMPARE && <span className="text-slate-500"> (max {MAX_COMPARE})</span>}
            </p>
            <Button variant="secondary" onClick={() => setPicked([])}>
              Clear
            </Button>
            <Button onClick={() => navigate(compareHref(picked))} disabled={picked.length < 2}>
              {picked.length < 2 ? 'Pick one more' : 'Compare'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
