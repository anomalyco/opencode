export type VisualRegionSample = {
  present: boolean
  visible: boolean
  inViewport: boolean
  cssHidden?: boolean
  top: number
  bottom: number
  layoutTop?: number
  layoutBottom?: number
  width: number
  height: number
  opacity: number
  count: number
  node: number
  label: string
  text: string
}

export type VisualViewportSample = {
  top: number
  bottom: number
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  distanceFromBottom: number
}

export type VisualObservation<RegionName extends string = string> = {
  at: number
  regions: string extends RegionName
    ? Record<string, VisualRegionSample>
    : Partial<Record<RegionName, VisualRegionSample>>
  viewport?: VisualViewportSample
}

export type VisualMarker = { at: number; label: string }

export type VisualStabilityTrace<RegionName extends string = string> = {
  markers: VisualMarker[]
  samples: VisualObservation<RegionName>[]
}

export type CapturedFrame = { at: number; data: string }

export type VisualProbeResult<RegionName extends string = string> = VisualStabilityTrace<RegionName> & {
  frames: CapturedFrame[]
}
