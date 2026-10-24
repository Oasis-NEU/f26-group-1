import type { Tables } from '../types/database'

// Columns needed to render a ListingCard.
export const LISTING_SUMMARY =
  'id, owner_id, title, neighborhood, rent_per_room, open_rooms, total_bedrooms, start_date, end_date, utilities_included, furnished, status, buildings(name)'

export type ListingSummary = Pick<
  Tables<'listings'>,
  | 'id'
  | 'owner_id'
  | 'title'
  | 'neighborhood'
  | 'rent_per_room'
  | 'open_rooms'
  | 'total_bedrooms'
  | 'start_date'
  | 'end_date'
  | 'utilities_included'
  | 'furnished'
  | 'status'
> & { buildings: { name: string } | null }
