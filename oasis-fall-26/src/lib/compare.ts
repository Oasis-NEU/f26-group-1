// Building comparison: the field catalog (shared with the scraper) plus pure helpers that
// format, rank and diff building_specs values. Rendering lives in pages/ComparePage.tsx.
import catalogJson from '../../../scraping/data/field_catalog.json'
import type { Json } from '../types/database'

export const MAX_COMPARE = 3

export type FieldType = 'text' | 'int' | 'money' | 'bool' | 'enum' | 'list' | 'places' | 'rates'

export type CatalogField = {
  key: string
  label: string
  type: FieldType
  unit?: string
  note?: string
  // Which way wins. For enums, `values` is listed best-first.
  better?: 'lower' | 'higher' | null
  values?: Record<string, string>
}

export type CatalogSection = { key: string; label: string; fields: CatalogField[] }

export const catalog = catalogJson as { version: number; sections: CatalogSection[] }

// One building_specs.specs entry. A missing key means unknown, never false.
export type Spec = { value: unknown; source: string; url?: string; status: string }
export type Specs = Record<string, Spec>

export function parseSpecs(json: Json | undefined): Specs {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {}
  const out: Specs = {}
  for (const [key, raw] of Object.entries(json)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('value' in raw)) continue
    out[key] = {
      value: raw.value,
      source: typeof raw.source === 'string' ? raw.source : 'unknown',
      url: typeof raw.url === 'string' && /^https?:\/\//.test(raw.url) ? raw.url : undefined,
      status: typeof raw.status === 'string' ? raw.status : 'unverified',
    }
  }
  return out
}

// Mirrors SOURCES in scraping/building_specs.py. Used for the footnotes.
const SOURCES: Record<string, { title: string; url?: string }> = {
  manual: { title: 'Checked by the NUSublet team' },
  nu_rates: { title: 'Northeastern Undergraduate Housing Rates 2026–2027', url: 'https://housing.northeastern.edu/rates/' },
  nu_housing: { title: 'Northeastern Housing and Residential Life building pages', url: 'https://housing.northeastern.edu/' },
  boston_open_data: { title: 'City of Boston open data, MBTA, OpenStreetMap, Bluebikes', url: 'https://data.boston.gov/' },
  building_list: { title: 'NUSublet building list' },
  official_site: { title: "The building's own website" },
}

export function sourceFor(spec: Spec) {
  const known = SOURCES[spec.source]
  return { key: `${spec.source}|${spec.url ?? ''}`, title: known?.title ?? spec.source, url: spec.url ?? known?.url }
}

const usd = (n: number) => `$${n.toLocaleString('en-US')}`
const PERIODS: Record<string, string> = { 'USD/month': '/mo', 'USD/semester': '/semester' }
const humanize = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replaceAll('_', ' ')
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function formatPlace(p: Record<string, unknown>) {
  const name = typeof p.name === 'string' ? p.name : '?'
  const detail = typeof p.detail === 'string' ? ` (${p.detail})` : ''
  const distance =
    typeof p.walk_minutes === 'number'
      ? ` · ${p.walk_minutes} min walk`
      : typeof p.distance_m === 'number'
        ? ` · ${p.distance_m.toLocaleString('en-US')} m`
        : ''
  return name + detail + distance
}

function formatRate(r: Record<string, unknown>) {
  const room = typeof r.room_type === 'string' ? humanize(r.room_type) : 'Room'
  const kind = [r.style, r.tier].filter((x) => typeof x === 'string').join(', ')
  const price = typeof r.semester_usd === 'number' ? `${usd(r.semester_usd)}/semester` : '—'
  return [
    r.chart === 'first_year' ? 'First-year: ' : '',
    room,
    kind && ` (${kind})`,
    ` · ${price}`,
    r.accommodation_only ? ' · accommodation only' : '',
  ].join('')
}

// A display string (or lines, for list types). null = the value doesn't match its type; show "—".
export function formatValue(field: CatalogField, value: unknown): string | string[] | null {
  switch (field.type) {
    case 'text':
      return typeof value === 'string' ? value : null
    case 'int':
      if (typeof value !== 'number') return null
      return field.unit ? `${value.toLocaleString('en-US')} ${field.unit}` : String(value)
    case 'money':
      return typeof value === 'number' ? usd(value) + (PERIODS[field.unit ?? ''] ?? '') : null
    case 'bool':
      return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : null
    case 'enum':
      return typeof value === 'string' ? (field.values?.[value] ?? humanize(value)) : null
    case 'list':
      return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : null
    case 'places':
      return Array.isArray(value) ? value.filter(isRecord).map(formatPlace) : null
    case 'rates':
      return Array.isArray(value) ? value.filter(isRecord).map(formatRate) : null
  }
}

// Yes/no fields read as phrases ("Elevator" / "No elevator") instead of "Yes" + a label.
const BOOL_PHRASES: Record<string, [yes: string, no: string]> = {
  'cost.internet_included': ['Internet included', 'Internet not included'],
  'cost.broker_fee': ['Broker fee', 'No broker fee'],
  'unit.furnished': ['Furnished', 'Unfurnished'],
  'amenities.elevator': ['Elevator', 'No elevator'],
  'amenities.fitness_center': ['Fitness center', 'No fitness center'],
  'amenities.lounge': ['Lounge or study space', 'No lounge or study space'],
  'amenities.dining_in_building': ['Dining hall in the building', 'No dining hall in the building'],
  'amenities.parking': ['Parking', 'No parking'],
  'amenities.pets_allowed': ['Pets allowed', 'No pets'],
  'amenities.bike_storage': ['Bike storage', 'No bike storage'],
  'amenities.package_room': ['Package room or lockers', 'No package room'],
  'amenities.roof_deck': ['Roof deck or courtyard', 'No roof deck or courtyard'],
}

// What one cell shows: the value, and a caption naming it (omitted when the phrase already does).
export type Described = { lines: string[]; caption?: string }

export function describe(field: CatalogField, value: unknown): Described | null {
  if (field.type === 'bool') {
    if (typeof value !== 'boolean') return null
    const [yes, no] = BOOL_PHRASES[field.key] ?? [field.label, `No ${field.label.charAt(0).toLowerCase()}${field.label.slice(1)}`]
    return { lines: [value ? yes : no] }
  }
  const text = formatValue(field, value)
  if (text === null || (Array.isArray(text) && text.length === 0)) return null
  return { lines: Array.isArray(text) ? text : [text], caption: field.label }
}

// Short label for the best value in a row, or null where a badge wouldn't help (yes/no, enums).
export function bestLabel(field: CatalogField): string | null {
  if (field.type !== 'int' && field.type !== 'money') return null
  if (field.key === 'overview.year_built') return 'Newest'
  if (field.unit === 'min' || field.unit === 'm') return 'Closest'
  if (field.type === 'money') return field.better === 'lower' ? 'Lowest' : 'Highest'
  return field.better === 'lower' ? 'Fewest' : 'Most'
}

export const fieldByKey = new Map(catalog.sections.flatMap((s) => s.fields.map((f) => [f.key, f] as const)))

// Bigger = better, or null when this field has no winner or the value can't be ranked.
function score(field: CatalogField, value: unknown): number | null {
  if (!field.better) return null
  const sign = field.better === 'higher' ? 1 : -1
  if ((field.type === 'int' || field.type === 'money') && typeof value === 'number') return sign * value
  if (field.type === 'bool' && typeof value === 'boolean') return sign * (value ? 1 : 0)
  if (field.type === 'enum' && typeof value === 'string' && field.values) {
    const rank = Object.keys(field.values).indexOf(value)
    return rank < 0 ? null : -sign * rank
  }
  return null
}

// Column indexes holding the best value. Empty unless 2+ values are rankable and they differ.
export function bestColumns(field: CatalogField, values: unknown[]): Set<number> {
  const scores = values.map((v) => (v === undefined ? null : score(field, v)))
  const known = scores.filter((s): s is number => s !== null)
  if (known.length < 2) return new Set()
  const top = Math.max(...known)
  if (known.every((s) => s === top)) return new Set()
  return new Set(scores.flatMap((s, i) => (s === top ? [i] : [])))
}

export function allSame(values: unknown[]) {
  const first = JSON.stringify(values[0])
  return values.every((v) => JSON.stringify(v) === first)
}

// ?b=slug1,slug2 → unique, non-empty, at most MAX_COMPARE.
export function parseSlugs(param: string | null) {
  return [...new Set((param ?? '').split(',').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_COMPARE)
}

export function compareHref(slugs: string[]) {
  return slugs.length ? `/compare?b=${slugs.map(encodeURIComponent).join(',')}` : '/compare'
}
