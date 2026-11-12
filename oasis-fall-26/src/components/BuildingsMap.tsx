import 'leaflet/dist/leaflet.css'
import { latLngBounds } from 'leaflet'
import { useEffect } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet'
import { Link } from 'react-router'

export type MapBuilding = {
  id: number
  name: string
  neighborhood: string
  latitude: number
  longitude: number
  openCount: number
}

type Props = {
  buildings: MapBuilding[]
  selectedId: number | null
  onSelect: (id: number) => void
}

// Northeastern's Boston campus, used when no building has coordinates yet.
const CAMPUS: [number, number] = [42.3398, -71.0892]

// Zoom to fit every pin whenever the set of buildings changes.
function FitToPins({ buildings }: { buildings: MapBuilding[] }) {
  const map = useMap()
  useEffect(() => {
    if (buildings.length === 0) return
    const bounds = latLngBounds(buildings.map((b) => [b.latitude, b.longitude]))
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 })
  }, [map, buildings])
  return null
}

// Circle markers are drawn as SVG, so there are no marker image assets to bundle.
// Default export so BuildingsPage can lazy-load Leaflet only on this page.
export default function BuildingsMap({ buildings, selectedId, onSelect }: Props) {
  return (
    <MapContainer center={CAMPUS} zoom={14} scrollWheelZoom className="h-full w-full">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToPins buildings={buildings} />
      {buildings.map((b) => {
        const selected = b.id === selectedId
        return (
          <CircleMarker
            key={b.id}
            center={[b.latitude, b.longitude]}
            radius={selected ? 11 : 8}
            pathOptions={{
              color: '#ffffff',
              weight: 2,
              fillColor: selected ? '#7f1d1d' : '#b91c1c',
              fillOpacity: 0.95,
            }}
            eventHandlers={{ click: () => onSelect(b.id) }}
          >
            <Popup>
              <p className="!m-0 font-semibold">{b.name}</p>
              <p className="!m-0 text-slate-600">{b.neighborhood}</p>
              {b.openCount > 0 && (
                <p className="!m-0 text-emerald-700">
                  {b.openCount} open {b.openCount === 1 ? 'sublet' : 'sublets'}
                </p>
              )}
              <Link to={`/buildings/${b.id}`} className="mt-1 inline-block text-red-700 underline">
                View building →
              </Link>
            </Popup>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}
