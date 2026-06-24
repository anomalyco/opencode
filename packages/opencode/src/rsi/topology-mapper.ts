/**
 * Topology Mapper — Negative Capability Geometry (Idea #3)
 * Converts raw fuzz failures into geometric objects with measurable structure.
 * Key insight: D > 1.2 means there's exploitable internal structure in failure space.
 */

export interface FailurePoint {
  input: unknown
  errorType: string
  errorMessage: string
  features: number[]  // normalized feature vector [0,1] per dimension
}

export interface FailureCluster {
  centroid: number[]
  members: FailurePoint[]
  internalVariance: number
}

export interface FailureTopology {
  rawFailures: FailurePoint[]
  clusters: FailureCluster[]
  boundaryType: 'flat' | 'convex' | 'fractal' | 'concave' | 'unknown'
  fractalDimension: number      // 1.0 = flat line, 1.2+ = exploitable, 2.0 = space-filling
  informationDensity: number    // unique info per failure point
  exploitableStructure: boolean // true when internal improvement possible without external data
}

/**
 * Box-counting fractal dimension.
 * Fit: D = -d(log N(ε)) / d(log ε) via linear regression on log-log plot.
 */
function boxCountingDimension(
  points: number[][],
  steps = 8
): number {
  if (points.length < 3) return 1.0

  const logInvEps: number[] = []
  const logN: number[] = []

  for (let s = 0; s < steps; s++) {
    const epsilon = 0.01 * Math.pow(50, s / (steps - 1))  // ε from 0.01 to 0.5
    const boxes = new Set<string>()

    for (const point of points) {
      const key = point.map(v => Math.floor(v / epsilon)).join(',')
      boxes.add(key)
    }

    logInvEps.push(Math.log(1 / epsilon))
    logN.push(Math.log(boxes.size))
  }

  return clamp(linearSlope(logInvEps, logN), 1.0, 2.0)
}

function linearSlope(x: number[], y: number[]): number {
  const n = x.length
  const sumX = x.reduce((a, b) => a + b, 0)
  const sumY = y.reduce((a, b) => a + b, 0)
  const sumXY = x.reduce((acc, xi, i) => acc + xi * (y[i] ?? 0), 0)
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0)
  const denom = n * sumX2 - sumX * sumX
  return denom === 0 ? 1.0 : (n * sumXY - sumX * sumY) / denom
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function euclidean(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((sum, ai, i) => sum + (ai - (b[i] ?? 0)) ** 2, 0))
}

/**
 * K-means++ clustering for failure points.
 */
function clusterFailures(
  points: FailurePoint[],
  k: number
): FailureCluster[] {
  if (points.length === 0) return []
  k = Math.min(k, points.length)

  // K-means++ initialization
  const centroids: number[][] = [points[0]!.features]

  for (let i = 1; i < k; i++) {
    const dists = points.map(p =>
      Math.min(...centroids.map(c => euclidean(p.features, c)))
    )
    const totalDist2 = dists.reduce((a, b) => a + b * b, 0)
    let threshold = Math.random() * totalDist2

    for (let j = 0; j < points.length; j++) {
      threshold -= (dists[j] ?? 0) ** 2
      if (threshold <= 0) { centroids.push(points[j]!.features); break }
    }
  }

  let assignments = new Array<number>(points.length).fill(0)

  for (let iter = 0; iter < 50; iter++) {
    const next = points.map(p => {
      let best = 0, bestDist = Infinity
      centroids.forEach((c, ci) => {
        const d = euclidean(p.features, c)
        if (d < bestDist) { bestDist = d; best = ci }
      })
      return best
    })

    const converged = next.every((a, i) => a === assignments[i])
    assignments = next
    if (converged) break

    centroids.forEach((_, ci) => {
      const members = points.filter((_, i) => assignments[i] === ci)
      if (members.length > 0) {
        centroids[ci] = members[0]!.features.map((_, dim) =>
          members.reduce((s, p) => s + (p.features[dim] ?? 0), 0) / members.length
        )
      }
    })
  }

  return centroids.map((centroid, ci) => {
    const members = points.filter((_, i) => assignments[i] === ci)
    const variance = members.length === 0 ? 0 :
      members.reduce((s, p) => s + euclidean(p.features, centroid) ** 2, 0) / members.length
    return { centroid, members, internalVariance: variance }
  }).filter(c => c.members.length > 0)
}

export function computeFailureTopology(failures: FailurePoint[]): FailureTopology {
  if (failures.length < 2) {
    return {
      rawFailures: failures,
      clusters: [],
      boundaryType: 'unknown',
      fractalDimension: 1.0,
      informationDensity: 0,
      exploitableStructure: false
    }
  }

  const k = Math.min(5, Math.ceil(Math.sqrt(failures.length)))
  const clusters = clusterFailures(failures, k)
  const featureVectors = failures.map(f => f.features)
  const D = boxCountingDimension(featureVectors)

  const boundaryType: FailureTopology['boundaryType'] =
    D < 1.05 ? 'flat' :
    D < 1.3  ? 'convex' :
    D < 1.7  ? 'fractal' :
               'concave'

  const uniqueTypes = new Set(failures.map(f => f.errorType)).size
  const informationDensity = uniqueTypes < 2 ? 0 :
    Math.log2(uniqueTypes) / Math.log2(failures.length + 1)

  return {
    rawFailures: failures,
    clusters,
    boundaryType,
    fractalDimension: D,
    informationDensity,
    exploitableStructure: D > 1.2 && clusters.length > 1
  }
}

/**
 * Extract FailurePoint feature vector from a raw fuzz result.
 * Normalizes string/error properties into numeric dimensions.
 */
export function extractFeatures(
  input: unknown,
  errorType: string,
  errorMessage: string
): number[] {
  // Dimension 0: input complexity (length or key count)
  const dim0 = typeof input === 'string' ? Math.min(input.length / 1000, 1) :
                typeof input === 'object' && input !== null
                  ? Math.min(Object.keys(input).length / 100, 1)
                  : 0.5

  // Dimension 1: error type hash (normalized)
  const dim1 = (errorType.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xFFFF, 0)) / 0xFFFF

  // Dimension 2: error message length (normalized)
  const dim2 = Math.min(errorMessage.length / 500, 1)

  // Dimension 3: error depth (stack trace depth proxy)
  const dim3 = Math.min((errorMessage.match(/\n/g)?.length ?? 0) / 20, 1)

  return [dim0, dim1, dim2, dim3]
}
