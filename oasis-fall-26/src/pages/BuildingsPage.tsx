import { useCallback } from 'react'
import { Link } from 'react-router'
import { ErrorMessage, Loading, PageTitle } from '../components/ui'
import { must, supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

export function BuildingsPage() {
  const load = useCallback(
    async () =>
      must(
        await supabase
          .from('buildings')
          .select('id, name, neighborhood, walk_minutes_to_campus, rent_range')
          .order('name'),
      ),
    [],
  )
  const { data: buildings, loading, error } = useAsync(load)

  return (
    <div>
      <PageTitle>Buildings</PageTitle>
      <p className="mb-6 text-sm text-slate-600">What students say about the buildings near campus.</p>
      {loading && <Loading />}
      <ErrorMessage error={error} />
      {buildings?.length === 0 && <p className="text-sm text-slate-600">No buildings yet.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {buildings?.map((b) => (
          <Link
            key={b.id}
            to={`/buildings/${b.id}`}
            className="block rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-red-300 hover:shadow"
          >
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
        ))}
      </div>
    </div>
  )
}
