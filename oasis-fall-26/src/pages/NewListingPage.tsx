import { useCallback, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Button, Card, Checkbox, ErrorMessage, Field, Input, PageTitle, Select, Textarea } from '../components/ui'
import { useAuth } from '../lib/auth'
import { NEIGHBORHOODS } from '../lib/format'
import { must, supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

const empty = {
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

type Form = typeof empty

// Friendly versions of the database's check constraints.
function validate(form: Form) {
  if (Number(form.open_rooms) > Number(form.total_bedrooms)) return 'Open rooms can’t be more than total bedrooms.'
  if (form.end_date <= form.start_date) return 'The end date must be after the start date.'
  if (form.fill_by > form.end_date) return 'The fill-by date must be on or before the end date.'
  return null
}

export function NewListingPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadBuildings = useCallback(
    async () => must(await supabase.from('buildings').select('id, name, neighborhood').order('name')),
    [],
  )
  const { data: buildings } = useAsync(loadBuildings)

  function set<K extends keyof Form>(key: K, value: Form[K]) {
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

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = validate(form)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    const { data, error } = await supabase
      .from('listings')
      .insert({
        owner_id: session!.user.id,
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
      })
      .select('id')
      .single()
    setBusy(false)
    if (error) return setError(error.message)
    navigate(`/listings/${data.id}`)
  }

  return (
    <div className="max-w-2xl">
      <PageTitle>List a room</PageTitle>
      <Card>
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
            <Field label="Building" hint="Optional. Missing? Pick none.">
              <Select value={form.building_id} onChange={(e) => chooseBuilding(e.target.value)}>
                <option value="">None / not listed</option>
                {buildings?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Neighborhood">
              <Select required value={form.neighborhood} onChange={(e) => set('neighborhood', e.target.value)}>
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
                min={1}
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
            <Textarea
              maxLength={2000}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
          <ErrorMessage error={error} />
          <Button type="submit" disabled={busy}>
            {busy ? 'Posting…' : 'Post listing'}
          </Button>
          <p className="text-xs text-slate-500">You can add photos and roommates on the next page.</p>
        </form>
      </Card>
    </div>
  )
}
