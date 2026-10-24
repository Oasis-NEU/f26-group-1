import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill them in.',
  )
}

// The one shared client. RLS is the backend, so this only ever uses the anon key.
export const supabase = createClient<Database>(url, anonKey)

export const PHOTO_BUCKET = 'listing-photos'

type Result = { data: unknown; error: { message: string } | null }

// Turns a Supabase { data, error } result into data, throwing on error.
// The return type comes from the success branch only, so maybeSingle() stays `Row | null`.
export function must<R extends Result>(result: R): Extract<R, { error: null }>['data'] {
  if (result.error) throw new Error(result.error.message)
  return result.data as Extract<R, { error: null }>['data']
}
