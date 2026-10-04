export type VisualRegionDefinition = {
  selector: string
  closest?: string
  opacitySelectors?: readonly string[]
}

export function defineVisualRegions<const Regions extends Record<string, VisualRegionDefinition>>(regions: Regions) {
  return regions
}

export function mapVisualRegions<const Regions extends Record<string, VisualRegionDefinition>, Result>(
  regions: Regions,
  map: (region: Regions[keyof Regions], name: keyof Regions) => Result,
) {
  return Object.fromEntries(
    Object.entries(regions).map(([name, region]) => [name, map(region as Regions[keyof Regions], name)]),
  ) as { [Name in keyof Regions]: Result }
}
