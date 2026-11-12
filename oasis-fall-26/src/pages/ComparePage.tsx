import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ErrorMessage, Loading } from '../components/ui'
import {
  MAX_COMPARE,
  allSame,
  bestColumns,
  bestLabel,
  catalog,
  compareHref,
  describe,
  fieldByKey,
  parseSlugs,
  parseSpecs,
  sourceFor,
  type CatalogField,
  type Spec,
  type Specs,
} from '../lib/compare'
import { formatDate } from '../lib/format'
import { must, supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

type Option = { slug: string; name: string }
type Column = { id: number; slug: string; name: string; neighborhood: string; scrapedAt: string; specs: Specs }
type Footnotes = Map<string, { n: number; title: string; url?: string }>

// Phones get 2 columns, wider screens 3. Every grid has MAX_COMPARE slots so columns line up.
const GRID = 'grid grid-cols-2 gap-x-5 sm:grid-cols-3 sm:gap-x-8'
// The third slot is hidden on phones. Class names are spelled out so Tailwind finds them.
const slotClass = (i: number, display: 'block' | 'flex' = 'block') =>
  i < 2 ? '' : display === 'flex' ? 'hidden sm:flex' : 'hidden sm:block'
const slots = Array.from({ length: MAX_COMPARE }, (_, i) => i)
const usd = (n: number) => `$${n.toLocaleString('en-US')}`

// Only buildings with loaded specs can be compared.
async function loadOptions() {
  const rows = must(
    await supabase
      .from('buildings')
      .select('slug, name, building_specs!inner(building_id)')
      .not('slug', 'is', null)
      .order('name'),
  )
  return rows.map((b): Option => ({ slug: b.slug ?? '', name: b.name }))
}

// Columns in the order of ?b=. Slugs without specs are dropped (the page lists them).
async function loadColumns(param: string | null) {
  const wanted = parseSlugs(param)
  if (wanted.length === 0) return []
  const rows = must(
    await supabase
      .from('buildings')
      .select('id, slug, name, neighborhood, building_specs!inner(specs, scraped_at)')
      .in('slug', wanted),
  )
  return wanted.flatMap((slug): Column[] => {
    const row = rows.find((r) => r.slug === slug)
    if (!row) return []
    const { specs, scraped_at } = row.building_specs
    return [{ id: row.id, slug, name: row.name, neighborhood: row.neighborhood, scrapedAt: scraped_at, specs: parseSpecs(specs) }]
  })
}

// The raw ?b= value and a setter. A hook so React Compiler treats the value as immutable.
// Navigates via compareHref rather than setSearchParams, which would encode the commas as %2C.
function useCompareParam() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const setSlugs = (next: string[]) => navigate(compareHref(parseSlugs(next.join(','))), { replace: true })
  return [params.get('b'), setSlugs] as const
}

// True once `ref` has scrolled above the top of the window.
function useScrolledPast(ref: RefObject<HTMLElement | null>, active: boolean) {
  const [past, setPast] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !active) return
    const observer = new IntersectionObserver(([entry]) => setPast(entry.boundingClientRect.bottom < 0))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, active])
  return past && active
}

const rentFrom = (c: Column) => {
  const v = c.specs['cost.rent_pp_month_min']?.value
  return typeof v === 'number' ? v : null
}

export function ComparePage() {
  const [param, setSlugs] = useCompareParam()
  const slugs = parseSlugs(param)
  const [onlyDifferences, setOnlyDifferences] = useState(false)

  const options = useAsync(loadOptions)
  const load = useCallback(() => loadColumns(param), [param])
  const { data: columns, loading, error } = useAsync(load)

  const headerRef = useRef<HTMLDivElement>(null)
  const shown = columns ?? []
  const pinned = useScrolledPast(headerRef, shown.length > 0)
  const missing = columns ? slugs.filter((s) => !columns.some((c) => c.slug === s)) : []
  const taken = new Set(shown.map((c) => c.slug))

  const sections = catalog.sections.flatMap((section) => {
    const rows = section.fields.flatMap((field) => {
      const values = shown.map((c) => c.specs[field.key]?.value)
      if (values.every((v) => v === undefined)) return []
      if (onlyDifferences && shown.length > 1 && allSame(values)) return []
      return [{ field, best: bestColumns(field, values) }]
    })
    return rows.length ? [{ section, rows }] : []
  })

  // Number the sources of the visible rows in the order they appear.
  const footnotes: Footnotes = new Map()
  for (const { rows } of sections)
    for (const { field } of rows)
      for (const col of shown) {
        const spec = col.specs[field.key]
        if (!spec) continue
        const src = sourceFor(spec)
        if (!footnotes.has(src.key)) footnotes.set(src.key, { n: footnotes.size + 1, title: src.title, url: src.url })
      }

  const scrapedAt = shown.map((c) => c.scrapedAt).sort()[0]

  return (
    <div>
      <header className="pt-4 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Compare buildings</h1>
        <p className="mt-3 text-base text-slate-600 sm:text-lg">Rent, rooms, amenities and location, side by side.</p>
        <Link to="/buildings" className="mt-2 inline-block text-base text-red-700 hover:underline">
          Browse all buildings ›
        </Link>
      </header>

      <div className="mt-6 space-y-2">
        <ErrorMessage error={options.error ?? error} />
        {options.data?.length === 0 && (
          <p className="text-center text-sm text-slate-600">No buildings have comparison data yet.</p>
        )}
        {missing.length > 0 && !loading && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">No comparison data for: {missing.join(', ')}</p>
        )}
      </div>

      {/* Column headers: building picker, rent headline, links. The first empty slot adds a building. */}
      <div ref={headerRef} className={`mt-8 ${GRID}`}>
        {slots.map((i) => {
          const col = shown[i]
          if (col) {
            const rent = rentFrom(col)
            return (
              <div key={col.slug} className={`min-w-0 ${slotClass(i)}`}>
                <BuildingSelect
                  label={`Column ${i + 1}`}
                  value={col.slug}
                  options={(options.data ?? []).filter((o) => o.slug === col.slug || !taken.has(o.slug))}
                  onChange={(slug) => setSlugs(shown.map((c) => (c.slug === col.slug ? slug : c.slug)))}
                />
                <p className="mt-4 text-sm text-slate-600">{col.neighborhood}</p>
                <p className="mt-1 text-base font-semibold leading-snug">
                  {rent !== null ? `From ${usd(rent)}/mo per person` : 'Rent not known yet'}
                </p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <Link to={`/buildings/${col.id}`} className="text-red-700 hover:underline">
                    View building ›
                  </Link>
                  <button
                    type="button"
                    onClick={() => setSlugs(shown.filter((c) => c.slug !== col.slug).map((c) => c.slug))}
                    className="text-slate-500 hover:text-slate-900 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          }
          if (i !== shown.length || (loading && slugs.length > 0)) return <div key={`empty-${i}`} className={slotClass(i)} />
          return (
            <div key="add" className={`min-w-0 ${slotClass(i)}`}>
              <BuildingSelect
                label="Add a building"
                value=""
                dashed
                options={(options.data ?? []).filter((o) => !taken.has(o.slug))}
                onChange={(slug) => setSlugs([...shown.map((c) => c.slug), slug])}
              />
            </div>
          )
        })}
      </div>

      {/* Compact names bar once the headers scroll away, so you always know which column is which. */}
      {pinned && (
        <div className="fixed inset-x-0 top-0 z-30 border-b border-slate-200 bg-white/90 shadow-sm backdrop-blur">
          <div className={`mx-auto max-w-5xl px-4 py-2.5 ${GRID}`}>
            {slots.map((i) => {
              const col = shown[i]
              const rent = col && rentFrom(col)
              return (
                <div key={i} className={`min-w-0 ${slotClass(i)}`}>
                  {col && (
                    <>
                      <p className="truncate text-sm font-semibold">{col.name}</p>
                      <p className="truncate text-xs text-slate-500">{rent ? `From ${usd(rent)}/mo` : col.neighborhood}</p>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {loading && slugs.length > 0 && (
        <div className="py-10 text-center">
          <Loading />
        </div>
      )}
      {!loading && shown.length === 0 && (
        <p className="py-10 text-center text-base text-slate-600">
          Pick up to {MAX_COMPARE} buildings above, or tick “Compare” on the{' '}
          <Link to="/buildings" className="text-red-700 hover:underline">
            buildings page
          </Link>
          .
        </p>
      )}

      {shown.length > 0 && (
        <>
          {shown.length > 1 && (
            <div className="mt-10 flex justify-end">
              <Switch label="Show only differences" checked={onlyDifferences} onChange={setOnlyDifferences} />
            </div>
          )}

          <Summary columns={shown} footnotes={footnotes} />

          {sections.length === 0 && (
            <p className="mt-16 text-center text-slate-600">These buildings match on everything we know.</p>
          )}
          {sections.map(({ section, rows }) => {
            const notes = rows.flatMap(({ field }) => (field.note ? [field] : []))
            return (
              <Section key={section.key} title={section.label}>
                <div className="space-y-8">
                  {rows.map(({ field, best }) => (
                    <div key={field.key} data-row={field.key} className={GRID}>
                      {slots.map((i) => (
                        <div key={i} className={`min-w-0 ${slotClass(i)}`}>
                          {shown[i] && (
                            <Cell field={field} spec={shown[i].specs[field.key]} best={best.has(i)} footnotes={footnotes} />
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                {notes.length > 0 && (
                  <div className="mt-8 space-y-1 text-xs leading-relaxed text-slate-500">
                    {notes.map((f) => (
                      <p key={f.key}>
                        <span className="font-medium text-slate-600">{f.label}:</span> {f.note}
                      </p>
                    ))}
                  </div>
                )}
              </Section>
            )
          })}

          <footer className="mt-20 space-y-3 border-t border-slate-200 pt-6 text-xs leading-relaxed text-slate-500">
            <p>
              “—” means we don’t know yet, not “no”. Green labels mark the best value among the buildings shown.
              {scrapedAt && ` Data collected ${formatDate(scrapedAt)}.`}
            </p>
            <ol className="space-y-1">
              {[...footnotes.values()].map((s) => (
                <li key={s.n} id={`source-${s.n}`}>
                  {s.n}.{' '}
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="underline hover:text-red-700">
                      {s.title}
                    </a>
                  ) : (
                    s.title
                  )}
                </li>
              ))}
            </ol>
          </footer>
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-16">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      <div className="mt-4 border-t border-slate-200 pt-8">{children}</div>
    </section>
  )
}

function FootnoteRef({ spec, footnotes }: { spec: Spec; footnotes: Footnotes }) {
  const note = footnotes.get(sourceFor(spec).key)
  if (!note) return null
  return (
    <sup className="ml-0.5 align-super text-[10px] font-normal tracking-normal">
      <a href={`#source-${note.n}`} className="text-slate-400 hover:text-red-700" aria-label={`Source ${note.n}`}>
        {note.n}
      </a>
    </sup>
  )
}

// One value: text, then a grey caption naming it, then badges. Unknown shows "—" with the caption
// so the row still makes sense when the only known value is in a column hidden on phones.
function Cell({ field, spec, best, footnotes }: { field: CatalogField; spec?: Spec; best: boolean; footnotes: Footnotes }) {
  const d = spec ? describe(field, spec.value) : null
  if (!d) {
    return (
      <div>
        <p className="text-base text-slate-400" aria-label="Unknown">
          —
        </p>
        <p className="mt-1 text-sm text-slate-400">{field.label}</p>
      </div>
    )
  }
  const label = best ? bestLabel(field) : null
  return (
    <div>
      <ul className="space-y-1 text-base leading-snug text-slate-900">
        {d.lines.map((line, j) => (
          <li key={j}>
            {line}
            {j === d.lines.length - 1 && spec && <FootnoteRef spec={spec} footnotes={footnotes} />}
          </li>
        ))}
      </ul>
      {d.caption && <p className="mt-1 text-sm text-slate-500">{d.caption}</p>}
      {(label || spec?.status !== 'verified') && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {label && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
              <CheckIcon /> {label}
            </span>
          )}
          {spec?.status !== 'verified' && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Unverified</span>
          )}
        </div>
      )}
    </div>
  )
}

// "At a glance": the few things students decide on, big and centered.
const HEROES = [
  { key: 'cost.rent_pp_month_min', show: (v: number) => usd(v), caption: 'per person / month, from' },
  { key: 'location.walk_min_campus', show: (v: number) => `${v} min`, caption: 'walk to campus' },
]

const HIGHLIGHTS: { key: string; icon: ReactNode; phrase: (v: unknown) => { text: string; caption?: string } | null }[] = [
  {
    key: 'amenities.laundry',
    icon: <LaundryIcon />,
    phrase: (v) =>
      ({ in_unit: { text: 'In-unit laundry' }, in_building: { text: 'Laundry in the building' }, none: { text: 'No laundry' } })[
        String(v)
      ] ?? null,
  },
  {
    key: 'unit.ac',
    icon: <SnowflakeIcon />,
    phrase: (v) =>
      ({ central: { text: 'Central air' }, unit: { text: 'Window or wall A/C' }, none: { text: 'No air conditioning' } })[String(v)] ??
      null,
  },
  {
    key: 'location.t_stations',
    icon: <TrainIcon />,
    phrase: (v) => {
      const first = (Array.isArray(v) && v[0] && typeof v[0] === 'object' ? v[0] : null) as Record<string, unknown> | null
      if (!first || typeof first.name !== 'string') return null
      const parts = [typeof first.detail === 'string' && first.detail, typeof first.walk_minutes === 'number' && `${first.walk_minutes} min walk`]
      return { text: `${first.name} station`, caption: parts.filter(Boolean).join(' · ') || undefined }
    },
  },
]

function Summary({ columns, footnotes }: { columns: Column[]; footnotes: Footnotes }) {
  const has = (key: string) => columns.some((c) => c.specs[key] !== undefined)
  const heroes = HEROES.filter((h) => has(h.key))
  const highlights = HIGHLIGHTS.filter((h) => has(h.key))
  if (!heroes.length && !highlights.length) return null

  return (
    <Section title="At a glance">
      <div className="space-y-12 text-center">
        {heroes.map((h) => {
          const field = fieldByKey.get(h.key)
          const best = field ? bestColumns(field, columns.map((c) => c.specs[h.key]?.value)) : new Set<number>()
          return (
            <div key={h.key} data-row={h.key} className={GRID}>
              {slots.map((i) => {
                const spec = columns[i]?.specs[h.key]
                const v = spec?.value
                return (
                  <div key={i} className={`min-w-0 ${slotClass(i)}`}>
                    {columns[i] && (
                      <>
                        <p
                          className={`text-4xl font-semibold tracking-tight sm:text-5xl ${typeof v === 'number' ? '' : 'text-slate-300'}`}
                        >
                          {typeof v === 'number' ? h.show(v) : '—'}
                          {spec && typeof v === 'number' && <FootnoteRef spec={spec} footnotes={footnotes} />}
                        </p>
                        <p className="mt-2 text-sm text-slate-600">{h.caption}</p>
                        {best.has(i) && field && (
                          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            <CheckIcon /> {bestLabel(field)}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
        {highlights.map((h) => (
          <div key={h.key} data-row={h.key} className={GRID}>
            {slots.map((i) => {
              const spec = columns[i]?.specs[h.key]
              const p = spec ? h.phrase(spec.value) : null
              return (
                <div key={i} className={`min-w-0 flex-col items-center ${i >= 2 ? '' : 'flex'} ${slotClass(i, 'flex')}`}>
                  {columns[i] && (
                    <>
                      <span className={`block size-10 ${p ? 'text-slate-800' : 'text-slate-300'}`}>{h.icon}</span>
                      <p className={`mt-3 text-base font-medium leading-snug ${p ? '' : 'text-slate-400'}`}>
                        {p ? p.text : '—'}
                        {p && spec && <FootnoteRef spec={spec} footnotes={footnotes} />}
                      </p>
                      {p?.caption && <p className="mt-1 text-sm text-slate-500">{p.caption}</p>}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </Section>
  )
}

function BuildingSelect({
  label,
  value,
  options,
  onChange,
  dashed = false,
}: {
  label: string
  value: string
  options: Option[]
  onChange: (slug: string) => void
  dashed?: boolean
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`block w-full appearance-none truncate rounded-xl border bg-white py-3 pr-9 pl-3 text-sm font-semibold sm:pr-10 sm:pl-4 shadow-sm focus:border-red-700 focus:ring-1 focus:ring-red-700 focus:outline-none sm:text-lg ${
          dashed ? 'border-dashed border-slate-400 text-slate-600' : 'border-slate-300 text-slate-900'
        }`}
      >
        {value === '' && <option value="">+ {label}</option>}
        {options.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.name}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-red-700"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M3.5 6l4.5 4.5L12.5 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-3 text-sm font-medium text-slate-700"
    >
      {label}
      <span className={`relative h-6 w-10 rounded-full transition ${checked ? 'bg-red-700' : 'bg-slate-300'}`}>
        <span
          className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition ${checked ? 'translate-x-4' : ''}`}
        />
      </span>
    </button>
  )
}

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className: 'size-full',
}

function LaundryIcon() {
  return (
    <svg {...iconProps}>
      <rect x="4" y="2.5" width="16" height="19" rx="2.5" />
      <line x1="4" y1="7" x2="20" y2="7" />
      <circle cx="7" cy="4.8" r="0.4" />
      <circle cx="12" cy="14" r="4.5" />
      <path d="M9.5 14.5c1-.8 1.8-.8 2.5 0s1.5.8 2.5 0" />
    </svg>
  )
}

function SnowflakeIcon() {
  return (
    <svg {...iconProps}>
      <line x1="12" y1="2.5" x2="12" y2="21.5" />
      <line x1="3.8" y1="7.25" x2="20.2" y2="16.75" />
      <line x1="3.8" y1="16.75" x2="20.2" y2="7.25" />
      <path d="M9.5 3.8L12 6l2.5-2.2M9.5 20.2L12 18l2.5 2.2" />
    </svg>
  )
}

function TrainIcon() {
  return (
    <svg {...iconProps}>
      <rect x="5" y="2.5" width="14" height="15" rx="3.5" />
      <line x1="5" y1="10" x2="19" y2="10" />
      <circle cx="9" cy="13.8" r="0.9" />
      <circle cx="15" cy="13.8" r="0.9" />
      <path d="M9 17.5l-2.5 4M15 17.5l2.5 4" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="size-3" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
