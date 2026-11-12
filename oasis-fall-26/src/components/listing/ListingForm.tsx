import { useCallback, useState, type FormEvent, type ReactNode } from 'react'
import { NEIGHBORHOODS } from '../../lib/format'
import { formToFields, validateListingForm, type ListingFields, type ListingFormValues } from '../../lib/listingForm'
import { must, supabase } from '../../lib/supabase'
import { useAsync } from '../../lib/useAsync'
import { Button, Checkbox, ErrorMessage, Field, Input, Select, Textarea } from '../ui'


type Props = {
  initial: ListingFormValues
  submitLabel: string
  busyLabel: string
  // Open listings need at least one open room; filled/closed ones may have 0.
  minOpenRooms?: number
  // Returns an error message, or null on success.
  onSubmit: (fields: ListingFields) => Promise<string | null>
  footer?: ReactNode
}

export function ListingForm({ initial, submitLabel, busyLabel, minOpenRooms = 1, onSubmit, footer }: Props) {
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadBuildings = useCallback(
    async () => must(await supabase.from('buildings').select('id, name, neighborhood').order('name')),
    [],
  )
  const { data: buildings } = useAsync(loadBuildings)

  function set<K extends keyof ListingFormValues>(key: K, value: ListingFormValues[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function chooseBuilding(id: string) {
    const building = buildings?.find((b) => String(b.id) === id)
    setForm((f) => ({
      ...f,
      building_id: id,
      neighborhood: building && NEIGHBORHOODS.includes(building.neighborhood) ? building.neighborhood : f.neighborhood,
    }))
  }

  // A preselected building (e.g. from ?building=) supplies the neighborhood until one is picked.
  const preselected = form.neighborhood ? undefined : buildings?.find((b) => String(b.id) === form.building_id)
  const neighborhood =
    form.neighborhood ||
    (preselected && NEIGHBORHOODS.includes(preselected.neighborhood) ? preselected.neighborhood : '')
  const values = { ...form, neighborhood }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = validateListingForm(values)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    const failure = await onSubmit(formToFields(values))
    setBusy(false)
    if (failure) setError(failure)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Title">
        <Input
          required
          maxLength={120}
          placeholder="e.g. Furnished room in a Fenway 4-bed"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Building" hint="Not in our database? Choose Other. You can link it later if it’s added.">
          <Select value={form.building_id} onChange={(e) => chooseBuilding(e.target.value)}>
            <option value="">Other / not listed</option>
            {buildings?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Neighborhood">
          <Select required value={neighborhood} onChange={(e) => set('neighborhood', e.target.value)}>
            <option value="" disabled>
              Choose…
            </option>
            {NEIGHBORHOODS.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Total bedrooms">
          <Input
            type="number"
            required
            min={1}
            max={10}
            value={form.total_bedrooms}
            onChange={(e) => set('total_bedrooms', e.target.value)}
          />
        </Field>
        <Field label="Open rooms">
          <Input
            type="number"
            required
            min={minOpenRooms}
            max={10}
            value={form.open_rooms}
            onChange={(e) => set('open_rooms', e.target.value)}
          />
        </Field>
        <Field label="Rent per room ($/mo)">
          <Input
            type="number"
            required
            min={1}
            step={1}
            value={form.rent_per_room}
            onChange={(e) => set('rent_per_room', e.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Available from">
          <Input type="date" required value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
        </Field>
        <Field label="Available until">
          <Input type="date" required value={form.end_date} onChange={(e) => set('end_date', e.target.value)} />
        </Field>
        <Field label="Fill by" hint="When you need someone by">
          <Input type="date" required value={form.fill_by} onChange={(e) => set('fill_by', e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-6">
        <Checkbox
          label="Utilities included"
          checked={form.utilities_included}
          onChange={(e) => set('utilities_included', e.target.checked)}
        />
        <Checkbox label="Furnished" checked={form.furnished} onChange={(e) => set('furnished', e.target.checked)} />
      </div>
      <Field label="Description" hint={`${form.description.length}/2000 · No street addresses or phone numbers.`}>
        <Textarea maxLength={2000} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <ErrorMessage error={error} />
      <Button type="submit" disabled={busy}>
        {busy ? busyLabel : submitLabel}
      </Button>
      {footer}
    </form>
  )
}
