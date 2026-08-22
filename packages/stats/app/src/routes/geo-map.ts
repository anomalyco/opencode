import { geoEquirectangular, geoPath } from "d3-geo"
import { feature, mesh } from "topojson-client"
import countriesTopologySource from "world-atlas/countries-110m.json?raw"
import type { FeatureCollection, GeometryObject, GeoJsonProperties } from "geojson"
import type { GeometryCollection, Topology } from "topojson-specification"

export const geoMapWidth = 960
export const geoMapHeight = 430

type WorldCountryProperties = GeoJsonProperties & { name?: string }
type WorldTopology = Topology<{ countries: GeometryCollection<WorldCountryProperties> }>

const worldTopology = JSON.parse(countriesTopologySource) as WorldTopology
const worldCountryGeometries: GeometryCollection<WorldCountryProperties> = {
  ...worldTopology.objects.countries,
  geometries: worldTopology.objects.countries.geometries.filter((country) => String(country.id ?? "") !== "010"),
}
const worldCountries = feature<WorldCountryProperties>(worldTopology, worldCountryGeometries) as FeatureCollection<
  GeometryObject,
  WorldCountryProperties
>
const worldProjection = geoEquirectangular().fitExtent(
  [
    [10, 12],
    [geoMapWidth - 10, geoMapHeight - 12],
  ],
  worldCountries,
)
const worldPath = geoPath(worldProjection)

export const worldCountryPaths = worldCountries.features.map((country) => ({
  id: String(country.id ?? "").padStart(3, "0"),
  path: worldPath(country) ?? "",
}))

export const worldBorderPath = worldPath(mesh(worldTopology, worldCountryGeometries, (a, b) => a !== b)) ?? ""

function geoCountryMarker(country: (typeof worldCountries.features)[number]) {
  const bounds = worldPath.bounds(country)
  const [x, y] = worldPath.centroid(country)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  if (bounds[1][0] - bounds[0][0] >= 3 && bounds[1][1] - bounds[0][1] >= 3) return undefined
  return { x, y }
}

// The 110m topology omits small regions. Geographic centroids keep those countries interactive without shipping 50m paths.
const fallbackCountryMarkerCoordinates = [
  ["016", -170.7179, -14.3046],
  ["020", 1.5606, 42.542],
  ["028", -61.7945, 17.2762],
  ["048", 50.5425, 26.0417],
  ["052", -59.5602, 13.1811],
  ["060", -64.7558, 32.3131],
  ["086", 72.4453, -7.3312],
  ["092", -64.4704, 18.5276],
  ["132", -23.9576, 15.9551],
  ["136", -80.9129, 19.43],
  ["174", 43.6844, -11.879],
  ["184", -159.7871, -21.2195],
  ["212", -61.3576, 15.4394],
  ["234", -6.8808, 62.0527],
  ["239", -36.4863, -54.4641],
  ["248", 19.9528, 60.2153],
  ["258", -144.8045, -14.7283],
  ["296", -167.9217, 0.893],
  ["308", -61.6818, 12.1174],
  ["316", 144.767, 13.4406],
  ["334", 73.52, -53.0872],
  ["336", 12.4343, 41.9021],
  ["344", 114.1143, 22.3983],
  ["438", 9.5357, 47.1367],
  ["446", 113.509, 22.2231],
  ["462", 73.4573, 3.7316],
  ["470", 14.405, 35.9215],
  ["480", 57.5714, -20.2779],
  ["492", 7.4073, 43.7526],
  ["500", -62.1856, 16.7404],
  ["520", 166.9326, -0.5189],
  ["531", -68.9721, 12.1957],
  ["533", -69.9827, 12.521],
  ["534", -63.0572, 18.0509],
  ["570", -169.8704, -19.0489],
  ["574", 167.9497, -29.0516],
  ["580", 145.6193, 15.8288],
  ["583", 153.2966, 7.5361],
  ["584", 170.3313, 7.015],
  ["585", 134.4056, 7.286],
  ["612", -128.3167, -24.3649],
  ["652", -62.841, 17.8988],
  ["654", -9.7009, -12.3548],
  ["659", -62.6873, 17.2647],
  ["660", -63.066, 18.2243],
  ["662", -60.9696, 13.8946],
  ["663", -63.0599, 18.0888],
  ["666", -56.3037, 46.9187],
  ["670", -61.2008, 13.2251],
  ["674", 12.4594, 43.9415],
  ["678", 6.7235, 0.4434],
  ["690", 55.476, -4.6601],
  ["702", 103.817, 1.359],
  ["776", -174.7998, -20.4161],
  ["796", -71.9734, 21.8312],
  ["831", -2.5726, 49.4678],
  ["832", -2.1272, 49.2181],
  ["833", -4.5388, 54.224],
  ["850", -64.8028, 17.9555],
  ["876", -177.3469, -13.8898],
  ["882", -172.1649, -13.7536],
] as const

export const worldCountryMarkers = [
  ...worldCountries.features.flatMap((country) => {
    const marker = geoCountryMarker(country)
    return marker ? [{ id: String(country.id ?? "").padStart(3, "0"), marker }] : []
  }),
  ...fallbackCountryMarkerCoordinates.flatMap(([id, longitude, latitude]) => {
    const marker = worldProjection([longitude, latitude])
    return marker ? [{ id, marker: { x: marker[0], y: marker[1] } }] : []
  }),
]
