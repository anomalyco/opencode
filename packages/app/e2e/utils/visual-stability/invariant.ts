import type { VisualRegionDefinition } from "./regions"

type RegionSet<RegionName extends string> = readonly RegionName[] | "all"

export type VisualInvariant<RegionName extends string = string> =
  | { type: "required"; regions: readonly RegionName[] }
  | { type: "continuous-any"; regions: readonly RegionName[] }
  | { type: "unique"; regions: readonly RegionName[] }
  | { type: "stable"; regions: readonly RegionName[] }
  | { type: "fixed"; regions: readonly RegionName[]; tolerance?: number }
  | { type: "opacity"; regions: RegionSet<RegionName>; floor?: number }
  | {
      type: "motion"
      regions: RegionSet<RegionName>
      tolerance?: number
      maxReversals?: number
      maxPositionReversals?: number
    }
  | { type: "continuity"; regions: RegionSet<RegionName> }
  | { type: "label-stability"; regions: RegionSet<RegionName> }
  | { type: "flow"; regions: readonly RegionName[]; overlapTolerance?: number }
  | { type: "preserve-bottom-anchor" }
  | { type: "acquire-bottom-anchor" }

export type VisualPlan<RegionName extends string = string> = {
  regionNames?: readonly RegionName[]
  invariants: readonly VisualInvariant<RegionName>[]
  markerRequired?: readonly RegionName[]
  perMarker?: boolean
  aggregateMotion?: boolean
}

export type LegacyVisualStabilityOptions<RegionName extends string = string> = {
  flow?: RegionName[]
  motionTolerance?: number
  opacityFloor?: number
  overlapTolerance?: number
  maxReversals?: number
  maxPositionReversals?: number
  stable?: RegionName[]
  fixed?: RegionName[]
  motion?: RegionName[]
  unique?: RegionName[]
  preserveBottomAnchor?: boolean
  acquireBottomAnchor?: boolean
  perMarker?: boolean
  continuousAny?: RegionName[][]
  required?: RegionName[]
  aggregateMotion?: boolean
  inferRequired?: boolean
}

export function visualPlan<const Regions extends Record<string, VisualRegionDefinition>>(
  regions: Regions,
  invariants: readonly VisualInvariant<Extract<keyof Regions, string>>[],
  options: Omit<VisualPlan<Extract<keyof Regions, string>>, "regionNames" | "invariants"> = {},
): VisualPlan<Extract<keyof Regions, string>> {
  return { ...options, regionNames: Object.keys(regions) as Extract<keyof Regions, string>[], invariants }
}

export function legacyVisualPlan<RegionName extends string>(
  options: LegacyVisualStabilityOptions<RegionName> = {},
): VisualPlan<RegionName> {
  const inferred =
    options.inferRequired === false
      ? []
      : [
          ...(options.stable ?? []),
          ...(options.fixed ?? []),
          ...(options.unique ?? []),
          ...(options.motion ?? []),
          ...(options.flow ?? []),
        ]
  return {
    perMarker: options.perMarker,
    aggregateMotion: options.aggregateMotion,
    markerRequired: [
      ...(options.required ?? []),
      ...(options.stable ?? []),
      ...(options.fixed ?? []),
      ...(options.unique ?? []),
      ...(options.motion ?? []),
      ...(options.flow ?? []),
    ],
    invariants: [
      { type: "required", regions: [...(options.required ?? []), ...inferred] },
      ...(options.continuousAny ?? []).map(
        (regions): VisualInvariant<RegionName> => ({ type: "continuous-any", regions }),
      ),
      ...(options.unique ? [{ type: "unique" as const, regions: options.unique }] : []),
      ...(options.stable ? [{ type: "stable" as const, regions: options.stable }] : []),
      ...(options.fixed
        ? [{ type: "fixed" as const, regions: options.fixed, tolerance: options.motionTolerance }]
        : []),
      { type: "opacity", regions: "all", floor: options.opacityFloor },
      { type: "continuity", regions: "all" },
      {
        type: "motion",
        regions: options.motion ?? "all",
        tolerance: options.motionTolerance,
        maxReversals: options.maxReversals,
        maxPositionReversals: options.maxPositionReversals,
      },
      { type: "label-stability", regions: "all" },
      ...(options.preserveBottomAnchor ? [{ type: "preserve-bottom-anchor" as const }] : []),
      ...(options.acquireBottomAnchor ? [{ type: "acquire-bottom-anchor" as const }] : []),
      ...(options.flow
        ? [{ type: "flow" as const, regions: options.flow, overlapTolerance: options.overlapTolerance }]
        : []),
    ],
  }
}
