export type FirstNavigationSample = {
  observedAtMs: number
  source: boolean
  destination: boolean
  content: boolean
  pathname?: string
  center?: string
}

function category(sample: FirstNavigationSample) {
  if (sample.destination && !sample.source) return "destination"
  if (sample.source && !sample.destination) return "source"
  if (!sample.content) return "blank"
  return "unknown"
}

export function summarizeFirstNavigation(samples: FirstNavigationSample[]) {
  const categories = samples.map(category)
  const stable = categories.findIndex(
    (value, index) =>
      value === "destination" && categories[index + 1] === "destination" && categories[index + 2] === "destination",
  )
  return {
    samples: samples.length,
    firstDestinationObservedMs: samples[categories.indexOf("destination")]?.observedAtMs ?? null,
    stableDestinationObservedMs: stable === -1 ? null : samples[stable + 2]!.observedAtMs,
    sourceSamples: categories.filter((value) => value === "source").length,
    blankSamples: categories.filter((value) => value === "blank").length,
    unknownSamples: categories.filter((value) => value === "unknown").length,
    destinationSamples: categories.filter((value) => value === "destination").length,
  }
}
