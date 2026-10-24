// Shrinks a photo to ~1600px on the long side and re-encodes it as WebP (~0.8)
// before upload. Falls back to JPEG in browsers that can't encode WebP.
export async function compressImage(file: File, maxSide = 1600, quality = 0.8): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
  let blob = await encode('image/webp')
  if (blob?.type !== 'image/webp') blob = await encode('image/jpeg')
  if (!blob) throw new Error('Could not process that image.')
  return blob
}

export function extensionFor(blob: Blob) {
  return blob.type === 'image/webp' ? 'webp' : 'jpg'
}
