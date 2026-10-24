import type { Enums } from '../types/database'

// Matching compares neighborhoods exactly, so forms pick from this list.
export const NEIGHBORHOODS = [
  'Fenway',
  'Symphony',
  'Mission Hill',
  'Back Bay',
  'South End',
  'Roxbury',
  'Jamaica Plain',
  'Allston/Brighton',
  'Brookline',
  'Other',
]

export const SEEKER_REASONS: Record<Enums<'seeker_reason'>, string> = {
  co_op: 'Co-op',
  summer_classes: 'Summer classes',
  internship: 'Internship',
  other: 'Other',
}

export const REPORT_REASONS: Record<Enums<'report_reason'>, string> = {
  out_of_date: 'Out of date',
  other: 'Something else',
}

// Postgres dates come back as 'YYYY-MM-DD'; parse as local dates, not UTC.
export function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDates(start: string, end: string) {
  return `${formatDate(start)} – ${formatDate(end)}`
}

export function formatRent(dollars: number) {
  return `$${dollars.toLocaleString('en-US')}/mo`
}
