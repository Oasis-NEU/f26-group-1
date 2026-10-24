import { useCallback } from 'react'
import { formatDates, formatRent, SEEKER_REASONS } from '../../lib/format'
import { must, supabase } from '../../lib/supabase'
import { useAsync } from '../../lib/useAsync'
import { Badge, Card, ErrorMessage, Loading } from '../ui'

// Active seekers whose dates line up with this listing (owner only), best first.
export function MatchingSeekers({ listingId }: { listingId: number }) {
  const load = useCallback(async () => {
    const matches = must(await supabase.rpc('match_seekers_for_listing', { p_listing: listingId }))
    if (matches.length === 0) return []
    const posts = must(
      await supabase
        .from('seeker_posts')
        .select('*, profiles(full_name, year, major)')
        .in(
          'id',
          matches.map((m) => m.seeker_post_id),
        ),
    )
    return matches.flatMap((m) => {
      const post = posts.find((p) => p.id === m.seeker_post_id)
      return post ? [{ ...post, score: m.score }] : []
    })
  }, [listingId])
  const { data: seekers, loading, error } = useAsync(load)

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Students looking for these dates</h2>
      {loading && <Loading />}
      <ErrorMessage error={error} />
      {seekers?.length === 0 && (
        <p className="text-sm text-slate-600">No matching seekers yet. Matches need at least 70% date overlap.</p>
      )}
      <ul className="divide-y divide-slate-100">
        {seekers?.map((s) => (
          <li key={s.id} className="flex items-start justify-between gap-4 py-3 text-sm">
            <div>
              <p className="font-medium">
                {s.profiles.full_name}
                <span className="font-normal text-slate-500">
                  {' '}
                  · {[s.profiles.year, s.profiles.major].filter(Boolean).join(', ')}
                </span>
              </p>
              <p className="text-slate-700">
                {SEEKER_REASONS[s.reason]} · {formatDates(s.start_date, s.end_date)} · up to{' '}
                {formatRent(s.budget_max)}
              </p>
              <p className="text-slate-600">
                {s.neighborhoods.length ? s.neighborhoods.join(', ') : 'Any neighborhood'}
              </p>
              {s.note && <p className="mt-1 text-slate-600">{s.note}</p>}
            </div>
            <Badge tone="green">Score {s.score}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  )
}
