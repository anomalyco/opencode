export type ShimmerConfig = {
  period: number
  rings: number
  sweepFraction: number
  coreWidth: number
  coreAmp: number
  softWidth: number
  softAmp: number
  tail: number
  tailAmp: number
  haloWidth: number
  haloOffset: number
  haloAmp: number
  breathBase: number
  noise: number
  ambientAmp: number
  ambientCenter: number
  ambientWidth: number
  shadowMix: number
  primaryMix: number
  originX: number
  originY: number
}

export const shimmerDefaults: ShimmerConfig = {
  period: 4600,
  rings: 2,
  sweepFraction: 1,
  coreWidth: 1.2,
  coreAmp: 1.9,
  softWidth: 10,
  softAmp: 1.6,
  tail: 5,
  tailAmp: 0.64,
  haloWidth: 4.3,
  haloOffset: 0.6,
  haloAmp: 0.16,
  breathBase: 0.04,
  noise: 0.1,
  ambientAmp: 0.36,
  ambientCenter: 0.5,
  ambientWidth: 0.34,
  shadowMix: 0.1,
  primaryMix: 0.3,
  originX: 4.5,
  originY: 13.5,
}

export const shimmerConfig: ShimmerConfig = { ...shimmerDefaults }
