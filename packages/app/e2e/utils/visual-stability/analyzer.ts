import type { VisualInvariant, VisualPlan } from "./invariant"
import type { VisualObservation, VisualStabilityTrace } from "./model"

export function analyzeVisualObservations<RegionName extends string>(
  observations: readonly VisualObservation<RegionName>[],
  plan: VisualPlan<RegionName>,
) {
  const issues: string[] = []
  const invariants = plan.invariants
  const names = [...new Set(observations.flatMap((sample) => Object.keys(sample.regions) as RegionName[]))]
  const required = regions(invariants, "required")
  const continuousAny = invariants.filter(
    (invariant): invariant is Extract<VisualInvariant<RegionName>, { type: "continuous-any" }> =>
      invariant.type === "continuous-any",
  )
  const unique = new Set(regions(invariants, "unique"))
  const stable = new Set(regions(invariants, "stable"))
  const fixed = invariants.filter(
    (invariant): invariant is Extract<VisualInvariant<RegionName>, { type: "fixed" }> => invariant.type === "fixed",
  )
  const opacity = invariants.filter(
    (invariant): invariant is Extract<VisualInvariant<RegionName>, { type: "opacity" }> => invariant.type === "opacity",
  )
  const continuity = invariants.filter(
    (invariant): invariant is Extract<VisualInvariant<RegionName>, { type: "continuity" }> =>
      invariant.type === "continuity",
  )
  const motion = invariants.filter(
    (invariant): invariant is Extract<VisualInvariant<RegionName>, { type: "motion" }> => invariant.type === "motion",
  )
  const labelStability = invariants.filter(
    (invariant): invariant is Extract<VisualInvariant<RegionName>, { type: "label-stability" }> =>
      invariant.type === "label-stability",
  )

  for (const name of new Set(required)) {
    if (!observations.some((sample) => sample.regions[name]?.visible)) issues.push(`${name} never rendered`)
  }
  for (const invariant of continuousAny) {
    if (!invariant.regions.some((name) => observations.some((sample) => sample.regions[name]?.visible)))
      issues.push(`${invariant.regions.join(" | ")} never rendered`)
  }

  for (const name of names) {
    const samples = observations.flatMap((observation) => {
      const region = observation.regions[name]
      if (!region) return []
      const clipped =
        observation.viewport && (region.bottom <= observation.viewport.top || region.top >= observation.viewport.bottom)
      return [{ at: observation.at, ...region, visible: region.visible && !clipped }]
    })
    const visible = samples.filter((sample) => sample.visible)
    if (visible.length === 0) continue
    if (unique.has(name)) {
      const duplicate = samples.find((sample) => sample.count > 1)
      if (duplicate) issues.push(`${name} appeared ${duplicate.count} times at ${Math.round(duplicate.at)}ms`)
    }
    if (stable.has(name)) {
      const identities = [...new Set(visible.map((sample) => sample.node).filter((node) => node > 0))]
      if (identities.length > 1) issues.push(`${name} remounted ${identities.length - 1} times`)
    }
    for (const invariant of fixed.filter((invariant) => includes(invariant.regions, name))) {
      const origin = visible[0]
      const movement = origin ? Math.max(0, ...visible.map((sample) => Math.abs(sample.top - origin.top))) : 0
      if (movement > (invariant.tolerance ?? 1))
        issues.push(`${name} moved ${Math.round(movement * 10) / 10}px in the viewport`)
    }
    for (const invariant of opacity.filter((invariant) => includes(invariant.regions, name))) {
      for (const sample of visible) {
        if (sample.opacity < (invariant.floor ?? 0.65))
          issues.push(`${name} opacity fell to ${sample.opacity} at ${Math.round(sample.at)}ms`)
      }
    }
    if (continuity.some((invariant) => includes(invariant.regions, name))) {
      const firstPresent = samples.findIndex((sample) => sample.present)
      const lastPresent = samples.findLastIndex((sample) => sample.present)
      if (samples.slice(firstPresent, lastPresent + 1).some((sample) => !sample.present))
        issues.push(`${name} disappeared between present frames`)
      const firstVisible = samples.findIndex((sample) => sample.visible)
      const lastVisible = samples.findLastIndex((sample) => sample.visible)
      if (
        firstVisible >= 0 &&
        samples.slice(firstVisible, lastVisible + 1).some((sample) => !sample.visible && sample.inViewport)
      )
        issues.push(`${name} blanked between visible frames`)
    }
    for (const invariant of motion.filter((invariant) => includes(invariant.regions, name))) {
      for (const metric of ["top", "bottom", "width", "height"] as const) {
        const directions = visible
          .slice(1)
          .map((sample, index) => sample[metric] - visible[index]![metric])
          .filter((delta) => Math.abs(delta) > (invariant.tolerance ?? 1))
          .map(Math.sign)
        const reversals = directions.slice(1).filter((direction, index) => direction !== directions[index]).length
        const allowed =
          metric === "top" || metric === "bottom"
            ? (invariant.maxPositionReversals ?? invariant.maxReversals ?? 1)
            : (invariant.maxReversals ?? 1)
        if (reversals > allowed) issues.push(`${name} ${metric} reversed ${reversals} times`)
      }
    }
    if (labelStability.some((invariant) => includes(invariant.regions, name))) {
      const labels = samples
        .map((sample) => sample.label)
        .filter((label) => label.length > 0)
        .filter((label, index, all) => label !== all[index - 1])
      if (labels.some((label, index) => labels.indexOf(label) !== index))
        issues.push(`${name} label reverted: ${labels.join(" -> ")}`)
    }
  }

  if (invariants.some((invariant) => invariant.type === "preserve-bottom-anchor")) {
    const viewports = observations.flatMap((sample) => (sample.viewport ? [sample.viewport] : []))
    if (viewports[0] && viewports[0].distanceFromBottom <= 4) {
      const lost = viewports.find((viewport) => viewport.distanceFromBottom > 4)
      if (lost) issues.push(`bottom anchor moved to ${lost.distanceFromBottom}px`)
    }
  }
  if (invariants.some((invariant) => invariant.type === "acquire-bottom-anchor")) {
    const final = observations.findLast((sample) => sample.viewport)?.viewport
    if (!final || final.distanceFromBottom > 4)
      issues.push(`did not acquire bottom anchor${final ? ` (${final.distanceFromBottom}px away)` : ""}`)
  }

  for (const invariant of continuousAny) {
    const active = observations.map((sample) => invariant.regions.some((name) => sample.regions[name]?.visible))
    const first = active.indexOf(true)
    const last = active.lastIndexOf(true)
    if (first >= 0 && active.slice(first, last + 1).some((value) => !value))
      issues.push(`${invariant.regions.join(" | ")} blanked between visible frames`)
  }

  for (const invariant of invariants.filter(
    (item): item is Extract<VisualInvariant<RegionName>, { type: "flow" }> => item.type === "flow",
  )) {
    for (const [before, after] of invariant.regions
      .slice(1)
      .map((after, index) => [invariant.regions[index]!, after])) {
      let maximum: { overlap: number; at: number } | undefined
      let inverted: { at: number } | undefined
      for (const sample of observations) {
        const first = sample.regions[before]
        const second = sample.regions[after]
        if (!first?.visible || !second?.visible) continue
        if (
          sample.viewport &&
          (first.bottom <= sample.viewport.top ||
            first.top >= sample.viewport.bottom ||
            second.bottom <= sample.viewport.top ||
            second.top >= sample.viewport.bottom)
        )
          continue
        const overlap = first.bottom - second.top
        if (first.top > second.top && !inverted) inverted = { at: sample.at }
        if (overlap > (invariant.overlapTolerance ?? 0.5) && (!maximum || overlap > maximum.overlap))
          maximum = { overlap, at: sample.at }
      }
      if (inverted) issues.push(`${before} rendered after ${after} at ${Math.round(inverted.at)}ms`)
      if (maximum)
        issues.push(
          `${before} overlapped ${after} by ${Math.round(maximum.overlap * 10) / 10}px at ${Math.round(maximum.at)}ms`,
        )
    }
  }
  return [...new Set(issues)]
}

export function analyzeVisualTraceByMarker<RegionName extends string>(
  trace: VisualStabilityTrace<RegionName>,
  plan: VisualPlan<RegionName>,
) {
  if (trace.markers.length === 0) return analyzeVisualObservations(trace.samples, plan)
  const required = [...new Set(plan.markerRequired ?? regions(plan.invariants, "required"))].flatMap((name) =>
    trace.samples.some((sample) => sample.regions[name]?.visible) ? [] : [`${name} never rendered`],
  )
  const withoutRequired = plan.invariants.filter((invariant) => invariant.type !== "required")
  const windows = trace.markers.flatMap((marker, index) => {
    const end = trace.markers[index + 1]?.at ?? Infinity
    const before = trace.samples.findLast((sample) => sample.at < marker.at)
    const samples = [
      ...(before ? [before] : []),
      ...trace.samples.filter((sample) => sample.at >= marker.at && sample.at < end),
    ]
    if (samples.length < 2) return []
    return analyzeVisualObservations(samples, { ...plan, perMarker: false, invariants: withoutRequired }).map(
      (issue) => `${marker.label}: ${issue}`,
    )
  })
  const aggregateMotion =
    plan.aggregateMotion === false
      ? []
      : analyzeVisualObservations(trace.samples, {
          invariants: plan.invariants.filter((invariant) => invariant.type === "motion"),
        }).filter((issue) => / (?:top|bottom|width|height) reversed \d+ times$/.test(issue))
  return [...new Set([...required, ...aggregateMotion, ...windows])]
}

function regions<RegionName extends string, Type extends VisualInvariant<RegionName>["type"]>(
  invariants: readonly VisualInvariant<RegionName>[],
  type: Type,
) {
  return invariants.flatMap((invariant) =>
    invariant.type === type && "regions" in invariant && invariant.regions !== "all" ? [...invariant.regions] : [],
  ) as RegionName[]
}

function includes<RegionName extends string>(regions: readonly RegionName[] | "all", name: RegionName) {
  return regions === "all" || regions.includes(name)
}
