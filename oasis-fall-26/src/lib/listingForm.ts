import type { Tables, TablesInsert } from '../types/database'

// Form state is all strings/booleans; building_id '' means "Other / not in the database".
export const EMPTY_LISTING_FORM = {
  title: '',
  neighborhood: '',
  building_id: '',
  total_bedrooms: '3',
  open_rooms: '1',
  rent_per_room: '',
  utilities_included: false,
  furnished: false,
  start_date: '',
  end_date: '',
  fill_by: '',
  description: '',
}

export type ListingFormValues = typeof EMPTY_LISTING_FORM

// The editable columns of a listing, as sent to insert/update.
export type ListingFields = Omit<TablesInsert<'listings'>, 'owner_id' | 'id' | 'status' | 'created_at' | 'updated_at'>

export function listingToForm(listing: Tables<'listings'>): ListingFormValues {
  return {
    title: listing.title,
    neighborhood: listing.neighborhood,
    building_id: listing.building_id === null ? '' : String(listing.building_id),
    total_bedrooms: String(listing.total_bedrooms),
    open_rooms: String(listing.open_rooms),
    rent_per_room: String(listing.rent_per_room),
    utilities_included: listing.utilities_included,
    furnished: listing.furnished,
    start_date: listing.start_date,
    end_date: listing.end_date,
    fill_by: listing.fill_by,
    description: listing.description ?? '',
  }
}

export function formToFields(form: ListingFormValues): ListingFields {
  return {
    title: form.title.trim(),
    neighborhood: form.neighborhood,
    building_id: form.building_id ? Number(form.building_id) : null,
    total_bedrooms: Number(form.total_bedrooms),
    open_rooms: Number(form.open_rooms),
    rent_per_room: Number(form.rent_per_room),
    utilities_included: form.utilities_included,
    furnished: form.furnished,
    start_date: form.start_date,
    end_date: form.end_date,
    fill_by: form.fill_by,
    description: form.description.trim() || null,
  }
}

// Friendly versions of the database's check constraints.
export function validateListingForm(form: ListingFormValues) {
  if (Number(form.open_rooms) > Number(form.total_bedrooms)) return 'Open rooms can’t be more than total bedrooms.'
  if (form.end_date <= form.start_date) return 'The end date must be after the start date.'
  if (form.fill_by > form.end_date) return 'The fill-by date must be on or before the end date.'
  return null
}
