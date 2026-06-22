export type SessionSwitchSample = {
  observedAtMs: number
  destination: string[]
  source: string[]
  hasVisibleRows: boolean
  last: boolean
  bottomErrorPx?: number
}

export function classifySessionSwitch(samples: SessionSwitchSample[]) {
  const firstDestination = samples.findIndex((sample) => sample.destination.length > 0)
  const firstCorrect = samples.findIndex(isCorrectDestination)
  const stable = samples.findIndex((_, index) => isStableSessionSwitch(samples.slice(index, index + 3)))
  return {
    firstDestinationObservedMs: samples[firstDestination]?.observedAtMs ?? null,
    firstCorrectObservedMs: samples[firstCorrect]?.observedAtMs ?? null,
    stableObservedMs: samples[stable + 2]?.observedAtMs ?? null,
    wrongDestinationSamples: samples
      .slice(firstDestination)
      .filter((sample) => sample.destination.length > 0 && !sample.last).length,
    blankSamples: samples.filter((sample) => !sample.hasVisibleRows).length,
    unknownSamples: samples.filter(
      (sample) => sample.hasVisibleRows && sample.destination.length === 0 && sample.source.length === 0,
    ).length,
    sourceSamples: samples.filter((sample) => sample.source.length > 0).length,
  }
}

export function isCorrectDestination(sample: SessionSwitchSample) {
  return (
    sample.destination.length > 0 &&
    sample.source.length === 0 &&
    sample.last &&
    Math.abs(sample.bottomErrorPx ?? Infinity) <= 1
  )
}

export function isStableSessionSwitch(samples: SessionSwitchSample[]) {
  return samples.length === 3 && samples.every(isCorrectDestination)
}

export function isStableDestination(samples: Pick<SessionSwitchSample, "last" | "bottomErrorPx">[]) {
  return (
    samples.length === 3 && samples.every((sample) => sample.last && Math.abs(sample.bottomErrorPx ?? Infinity) <= 1)
  )
}
