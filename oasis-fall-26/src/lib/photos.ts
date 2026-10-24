import { compressImage, extensionFor } from './images'
import { must, PHOTO_BUCKET, supabase } from './supabase'

export const MAX_PHOTOS = 8

export type Photo = { id: number; path: string; position: number; url: string | null }

// The bucket is private, so photos are shown through signed URLs (valid 1 hour).
export async function signPhotos(rows: Omit<Photo, 'url'>[]): Promise<Photo[]> {
  if (rows.length === 0) return []
  const signed = must(
    await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(
      rows.map((r) => r.path),
      60 * 60,
    ),
  )
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((r) => ({ ...r, url: signed.find((s) => s.path === r.path)?.signedUrl ?? null }))
}

// Path must be {owner_id}/{listing_id}/... — storage and table policies both check it.
export async function uploadPhoto(file: File, ownerId: string, listingId: number, position: number) {
  const blob = await compressImage(file)
  const path = `${ownerId}/${listingId}/${crypto.randomUUID()}.${extensionFor(blob)}`
  must(await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: blob.type }))
  const { error } = await supabase.from('listing_photos').insert({ listing_id: listingId, path, position })
  if (error) {
    await supabase.storage.from(PHOTO_BUCKET).remove([path])
    throw new Error(error.message)
  }
}

export async function removePhoto(photo: Photo) {
  must(await supabase.from('listing_photos').delete().eq('id', photo.id))
  await supabase.storage.from(PHOTO_BUCKET).remove([photo.path])
}
