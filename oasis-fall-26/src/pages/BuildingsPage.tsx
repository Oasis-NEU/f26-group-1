import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button, Checkbox, ErrorMessage, Loading, PageTitle } from '../components/ui'
import { MAX_COMPARE, compareHref } from '../lib/compare'
import { must, supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

export function BuildingsPage() {
  const navigate = useNavigate()
  const load = useCallback(
    async () =>
      must(
        await supabase
          .from('buildings')
          .select('id, slug, name, neighborhood, walk_minutes_to_campus, rent_range, building_specs(building_id)')
          .order('name'),
      ),
    [],
  )
  const { data: buildings, loading, error } = useAsync(load)
  // Slugs ticked for comparison, in the order they were picked.
  const [picked, setPicked] = useState<string[]>([])
  const pickedNames = picked.map((slug) => buildings?.find((b) => b.slug === slug)?.name ?? slug)

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
      {buildings?.length === 0 && <p className="text-sm text-slate-600">No buildings yet.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {buildings?.map((b) => {
          const comparable = b.slug !== null && b.building_specs !== null
          const checked = b.slug !== null && picked.includes(b.slug)
          return (
            <div
              key={b.id}
              className="flex flex-col rounded-lg border border-slate-200 bg-white shadow-sm transition hover:border-red-300 hover:shadow"
            >
              <Link to={`/buildings/${b.id}`} className="block flex-1 p-5">
                <h2 className="font-semibold">{b.name}</h2>
                <p className="mt-1 text-sm text-slate-600">{b.neighborhood}</p>
                <p className="mt-3 text-sm text-slate-700">
                  {[
                    b.walk_minutes_to_campus !== null && `${b.walk_minutes_to_campus} min walk`,
                    b.rent_range,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
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
