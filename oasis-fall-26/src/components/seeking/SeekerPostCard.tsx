import { useCallback, useState } from 'react'
import { formatDates, formatRent, SEEKER_REASONS } from '../../lib/format'
import { LISTING_SUMMARY } from '../../lib/listings'
import { must, supabase } from '../../lib/supabase'
import { useAsync } from '../../lib/useAsync'
import type { Enums, Tables } from '../../types/database'
import { ListingCard } from '../ListingCard'
import { Badge, Button, Card, ErrorMessage, Loading } from '../ui'

const statusTone = { active: 'green', paused: 'amber', housed: 'slate' } as const

export function SeekerPostCard({ post, onChange }: { post: Tables<'seeker_posts'>; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null)

  async function update(status: Enums<'seeker_status'>) {
    setError(null)
    const { error } = await supabase.from('seeker_posts').update({ status }).eq('id', post.id)
    if (error) setError(error.message)
    else onChange()
  }

  async function remove() {
    if (!confirm('Delete this post?')) return
    const { error } = await supabase.from('seeker_posts').delete().eq('id', post.id)
    if (error) setError(error.message)
    else onChange()
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            {SEEKER_REASONS[post.reason]} · {formatDates(post.start_date, post.end_date)}
          </p>
          <p className="text-sm text-slate-600">
            Up to {formatRent(post.budget_max)} ·{' '}
            {post.neighborhoods.length ? post.neighborhoods.join(', ') : 'Any neighborhood'}
          </p>
          {post.note && <p className="mt-1 text-sm text-slate-600">{post.note}</p>}
        </div>
        <Badge tone={statusTone[post.status]}>{post.status}</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {post.status === 'active' && (
          <Button variant="secondary" onClick={() => update('paused')}>
            Pause
          </Button>
        )}
        {post.status !== 'active' && (
          <Button variant="secondary" onClick={() => update('active')}>
            Reactivate
          </Button>
        )}
        {post.status !== 'housed' && (
          <Button variant="secondary" onClick={() => update('housed')}>
            I found a place
          </Button>
        )}
        <Button variant="secondary" onClick={remove}>
          Delete
        </Button>
      </div>
      <ErrorMessage error={error} />

      {post.status === 'active' && <MatchingListings postId={post.id} />}
    </Card>
  )
}

// Rooms whose dates line up with this post, best first (date fit > budget > neighborhood).
function MatchingListings({ postId }: { postId: number }) {
  const load = useCallback(async () => {
    const matches = must(await supabase.rpc('match_listings_for_seeker', { p_seeker_post: postId }))
    if (matches.length === 0) return []
    const listings = must(
      await supabase
        .from('listings')
        .select(LISTING_SUMMARY)
        .in(
          'id',
          matches.map((m) => m.listing_id),
        ),
    )
    return matches.flatMap((m) => {
      const listing = listings.find((l) => l.id === m.listing_id)
      return listing ? [{ listing, score: m.score }] : []
    })
  }, [postId])
  const { data: matches, loading, error } = useAsync(load)

  return (
    <div className="space-y-3 border-t border-slate-100 pt-4">
      <h3 className="text-sm font-semibold">Rooms that fit your dates</h3>
      {loading && <Loading />}
      <ErrorMessage error={error} />
      {matches?.length === 0 && (
        <p className="text-sm text-slate-600">
          Nothing yet. A room shows up here when it covers at least 70% of your dates.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {matches?.map(({ listing, score }) => (
          <ListingCard key={listing.id} listing={listing} score={score} />
        ))}
      </div>
    </div>
  )
}
