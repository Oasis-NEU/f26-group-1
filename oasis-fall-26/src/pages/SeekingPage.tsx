import { useCallback, useState } from 'react'
import { SeekerPostCard } from '../components/seeking/SeekerPostCard'
import { SeekerPostForm } from '../components/seeking/SeekerPostForm'
import { Button, ErrorMessage, Loading, PageTitle } from '../components/ui'
import { useAuth } from '../lib/auth'
import { must, supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

export function SeekingPage() {
  const { session } = useAuth()
  const userId = session!.user.id
  const [formOpen, setFormOpen] = useState(false)

  const load = useCallback(
    async () =>
      must(
        await supabase
          .from('seeker_posts')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
      ),
    [userId],
  )
  const { data: posts, loading, error, reload } = useAsync(load)
  const showForm = formOpen || posts?.length === 0

  return (
    <div className="max-w-3xl space-y-6">
      <PageTitle
        action={
          posts &&
          posts.length > 0 && (
            <Button variant={formOpen ? 'secondary' : 'primary'} onClick={() => setFormOpen(!formOpen)}>
              {formOpen ? 'Cancel' : 'New post'}
            </Button>
          )
        }
      >
        Looking for a room
      </PageTitle>
      <p className="text-sm text-slate-600">
        Post the dates you need. We only show rooms whose dates actually line up, ranked by date fit, then budget,
        then neighborhood.
      </p>

      {loading && <Loading />}
      <ErrorMessage error={error} />

      {showForm && (
        <SeekerPostForm
          userId={userId}
          onCreated={() => {
            setFormOpen(false)
            reload()
          }}
        />
      )}

      {posts?.map((post) => (
        <SeekerPostCard key={post.id} post={post} onChange={reload} />
      ))}
    </div>
  )
}
