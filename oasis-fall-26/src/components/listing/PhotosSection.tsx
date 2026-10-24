import { useState } from 'react'
import { MAX_PHOTOS, removePhoto, uploadPhoto, type Photo } from '../../lib/photos'
import { errorMessage } from '../../lib/useAsync'
import { ErrorMessage } from '../ui'

type Props = {
  listingId: number
  ownerId: string
  photos: Photo[]
  isOwner: boolean
  onChange: () => void
}

export function PhotosSection({ listingId, ownerId, photos, isOwner, onChange }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const freeSlot = Array.from({ length: MAX_PHOTOS }, (_, i) => i).find(
    (slot) => !photos.some((p) => p.position === slot),
  )

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChange()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (photos.length === 0 && !isOwner) return null

  return (
    <section className="space-y-3">
      {photos.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos.map((photo, i) => (
            <figure key={photo.id} className="relative overflow-hidden rounded-lg bg-slate-200">
              {photo.url && <img src={photo.url} alt={`Photo ${i + 1}`} className="aspect-[4/3] w-full object-cover" />}
              {isOwner && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => removePhoto(photo))}
                  className="absolute right-2 top-2 rounded bg-white/90 px-2 py-1 text-xs font-medium shadow hover:bg-white"
                >
                  Remove
                </button>
              )}
            </figure>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-600">No photos yet. Listings with photos get more interest.</p>
      )}
      {isOwner && freeSlot !== undefined && (
        <label className="inline-block cursor-pointer rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">
          {busy ? 'Working…' : `Add photo (${photos.length}/${MAX_PHOTOS})`}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void run(() => uploadPhoto(file, ownerId, listingId, freeSlot))
            }}
          />
        </label>
      )}
      <ErrorMessage error={error} />
    </section>
  )
}
