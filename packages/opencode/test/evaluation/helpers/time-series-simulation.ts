import type { Trace } from "../../../src/trace"

/**
 * Time-series simulation utilities for realistic temporal patterns.
 * 
 * Simulates real-world patterns including:
 * - Daily cycles (business hours vs off-hours)
 * - Weekly cycles (weekday vs weekend)
 * - Gradual degradation (performance drift)
 * - Seasonal trends
 * - Spike patterns (sudden anomalies)
 * - Noise injection (realistic variance)
 */

const generateId = () => `trace-${Date.now()}-${Math.random()}`

interface TraceOptions {
  cost?: number
  duration?: number
  errorCount?: number
  timestamp?: number
}

function createTraceWithOptions(options: TraceOptions): Trace.Complete {
  return {
    id: generateId(),
    projectID: "test-project",
    session: {} as any,
    messageCount: 5,
    agentName: "droid",
    modelConfig: {
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
    },
    output: "Test trace",
    toolCalls: [
      {
        id: "Read",
        sessionID: "test-session",
        timestamp: options.timestamp || Date.now(),
        duration: options.duration ? Math.floor(options.duration / 2) : 100,
        status: "success",
      },
    ],
    summary: {
      duration: options.duration || 1000,
      toolCallCount: 1,
      errorCount: options.errorCount || 0,
      tokens: {
        input: 100,
        output: 50,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      cost: options.cost || 0.02,
    },
    evaluationIDs: [],
    createdAt: options.timestamp || Date.now(),
    completedAt: (options.timestamp || Date.now()) + (options.duration || 1000),
  }
}

export class TimeSeriesSimulator {
  /**
   * Generate traces with daily pattern - higher load during business hours.
   * 
   * Realistic pattern: 9am-5pm sees 1.5x load, off-hours sees 0.7x load
   * 
   * @param days Number of days to simulate
   * @param samplesPerDay Number of traces per day (default: 24, one per hour)
   * @param baseCost Base cost per trace (default: 0.02)
   * @param variance Random variance percentage (default: 0.1 = 10%)
   */
  static dailyPattern(
    days: number,
    samplesPerDay: number = 24,
    baseCost: number = 0.02,
    variance: number = 0.1
  ): Trace.Complete[] {
    const traces: Trace.Complete[] = []
    const baseTime = Date.now() - days * 24 * 60 * 60 * 1000
    const hoursPerSample = 24 / samplesPerDay

    for (let day = 0; day < days; day++) {
      for (let sample = 0; sample < samplesPerDay; sample++) {
        const hour = Math.floor((sample * hoursPerSample) % 24)
        const timestamp =
          baseTime +
          day * 24 * 60 * 60 * 1000 +
          sample * hoursPerSample * 60 * 60 * 1000

        // Business hours (9-17) have higher load
        const isBusinessHours = hour >= 9 && hour <= 17
        const loadMultiplier = isBusinessHours ? 1.5 : 0.7

        // Add random variance
        const noise = 1 + (Math.random() * variance * 2 - variance)

        traces.push(
          createTraceWithOptions({
            timestamp,
            cost: baseCost * loadMultiplier * noise,
            duration: Math.floor(1000 * loadMultiplier * noise),
          })
        )
      }
    }

    return traces
  }

  /**
   * Generate gradual degradation pattern - performance declining over time.
   * 
   * Simulates system degradation, memory leaks, or model quality drift.
   * 
   * @param samples Number of samples to generate
   * @param degradationRate Rate of degradation (0.05 = 5% increase over full period)
   * @param baseCost Starting cost (default: 0.02)
   */
  static degradation(
    samples: number,
    degradationRate: number = 0.05,
    baseCost: number = 0.02
  ): Trace.Complete[] {
    const baseTime = Date.now() - samples * 60 * 60 * 1000 // Hourly samples
    return Array.from({ length: samples }, (_, i) => {
      const progress = i / samples
      const degradationFactor = 1 + progress * degradationRate
      const timestamp = baseTime + i * 60 * 60 * 1000

      // Errors increase in later stages
      const errorCount = progress > 0.8 && Math.random() > 0.7 ? 1 : 0

      return createTraceWithOptions({
        timestamp,
        cost: baseCost * degradationFactor,
        duration: Math.floor(1000 * degradationFactor),
        errorCount,
      })
    })
  }

  /**
   * Generate traces with sudden spike anomaly.
   * 
   * @param normalCount Number of normal traces before spike
   * @param spikeIntensity Multiplier for spike (default: 5x)
   * @param spikePosition Position of spike (default: middle)
   * @param baseCost Base cost (default: 0.02)
   */
  static withSpike(
    normalCount: number,
    spikeIntensity: number = 5,
    spikePosition?: number,
    baseCost: number = 0.02
  ): Trace.Complete[] {
    const baseTime = Date.now() - normalCount * 60 * 60 * 1000
    const position = spikePosition ?? Math.floor(normalCount / 2)

    return Array.from({ length: normalCount }, (_, i) => {
      const timestamp = baseTime + i * 60 * 60 * 1000
      const isSpike = i === position

      return createTraceWithOptions({
        timestamp,
        cost: baseCost * (isSpike ? spikeIntensity : 1),
        duration: Math.floor(1000 * (isSpike ? spikeIntensity : 1)),
        errorCount: isSpike ? 1 : 0,
      })
    })
  }

  /**
   * Generate traces with multiple spikes at regular intervals.
   * 
   * @param totalCount Total number of traces
   * @param spikeInterval Interval between spikes
   * @param spikeIntensity Multiplier for spikes (default: 3x)
   * @param baseCost Base cost (default: 0.02)
   */
  static withPeriodicSpikes(
    totalCount: number,
    spikeInterval: number,
    spikeIntensity: number = 3,
    baseCost: number = 0.02
  ): Trace.Complete[] {
    const baseTime = Date.now() - totalCount * 60 * 60 * 1000

    return Array.from({ length: totalCount }, (_, i) => {
      const timestamp = baseTime + i * 60 * 60 * 1000
      const isSpike = i % spikeInterval === 0 && i > 0

      return createTraceWithOptions({
        timestamp,
        cost: baseCost * (isSpike ? spikeIntensity : 1),
        duration: Math.floor(1000 * (isSpike ? spikeIntensity : 1)),
      })
    })
  }

  /**
   * Generate seasonal pattern with weekly cycles.
   * 
   * Realistic pattern: Weekends have ~30% of weekday load
   * 
   * @param weeks Number of weeks to simulate
   * @param samplesPerDay Samples per day (default: 10)
   * @param baseCost Base cost (default: 0.02)
   */
  static seasonal(
    weeks: number,
    samplesPerDay: number = 10,
    baseCost: number = 0.02
  ): Trace.Complete[] {
    const traces: Trace.Complete[] = []
    const baseTime = Date.now() - weeks * 7 * 24 * 60 * 60 * 1000

    for (let week = 0; week < weeks; week++) {
      for (let day = 0; day < 7; day++) {
        // Weekend days (5=Saturday, 6=Sunday) have lower load
        const isWeekend = day >= 5
        const loadMultiplier = isWeekend ? 0.3 : 1.0

        for (let sample = 0; sample < samplesPerDay; sample++) {
          const timestamp =
            baseTime +
            (week * 7 + day) * 24 * 60 * 60 * 1000 +
            sample * (24 / samplesPerDay) * 60 * 60 * 1000

          const noise = 1 + (Math.random() * 0.1 * 2 - 0.1) // 10% variance

          traces.push(
            createTraceWithOptions({
              timestamp,
              cost: baseCost * loadMultiplier * noise,
              duration: Math.floor(1000 * loadMultiplier * noise),
            })
          )
        }
      }
    }

    return traces
  }

  /**
   * Generate linear trend - steady improvement or degradation.
   * 
   * @param samples Number of samples
   * @param startCost Starting cost
   * @param endCost Ending cost
   * @param addNoise Whether to add realistic noise (default: true)
   */
  static linearTrend(
    samples: number,
    startCost: number,
    endCost: number,
    addNoise: boolean = true
  ): Trace.Complete[] {
    const baseTime = Date.now() - samples * 60 * 60 * 1000
    const costDelta = endCost - startCost

    return Array.from({ length: samples }, (_, i) => {
      const progress = i / samples
      const cost = startCost + costDelta * progress
      const noise = addNoise ? 1 + (Math.random() * 0.05 * 2 - 0.05) : 1
      const timestamp = baseTime + i * 60 * 60 * 1000

      return createTraceWithOptions({
        timestamp,
        cost: cost * noise,
        duration: Math.floor(1000 * (cost / startCost) * noise),
      })
    })
  }

  /**
   * Generate stable pattern with minimal variance.
   * 
   * @param samples Number of samples
   * @param cost Fixed cost (default: 0.02)
   * @param variance Variance percentage (default: 0.02 = 2%)
   */
  static stable(
    samples: number,
    cost: number = 0.02,
    variance: number = 0.02
  ): Trace.Complete[] {
    const baseTime = Date.now() - samples * 60 * 60 * 1000

    return Array.from({ length: samples }, (_, i) => {
      const noise = 1 + (Math.random() * variance * 2 - variance)
      const timestamp = baseTime + i * 60 * 60 * 1000

      return createTraceWithOptions({
        timestamp,
        cost: cost * noise,
        duration: Math.floor(1000 * noise),
      })
    })
  }

  /**
   * Generate bimodal distribution - two distinct performance modes.
   * 
   * Realistic scenario: Cached vs uncached requests, simple vs complex tasks
   * 
   * @param samples Number of samples
   * @param mode1Cost Cost for mode 1 (default: 0.01)
   * @param mode2Cost Cost for mode 2 (default: 0.05)
   * @param mode1Probability Probability of mode 1 (default: 0.7 = 70%)
   */
  static bimodal(
    samples: number,
    mode1Cost: number = 0.01,
    mode2Cost: number = 0.05,
    mode1Probability: number = 0.7
  ): Trace.Complete[] {
    const baseTime = Date.now() - samples * 60 * 60 * 1000

    return Array.from({ length: samples }, (_, i) => {
      const isMode1 = Math.random() < mode1Probability
      const cost = isMode1 ? mode1Cost : mode2Cost
      const timestamp = baseTime + i * 60 * 60 * 1000

      return createTraceWithOptions({
        timestamp,
        cost,
        duration: Math.floor(cost * 50000), // Duration correlates with cost
      })
    })
  }

  /**
   * Generate A/B test pattern - two populations with different characteristics.
   * 
   * @param samples Number of samples per group
   * @param groupACost Cost for group A (default: 0.02)
   * @param groupBCost Cost for group B (default: 0.025)
   * @param variance Variance for both groups (default: 0.1)
   */
  static abTest(
    samples: number,
    groupACost: number = 0.02,
    groupBCost: number = 0.025,
    variance: number = 0.1
  ): { groupA: Trace.Complete[]; groupB: Trace.Complete[] } {
    const baseTime = Date.now() - samples * 2 * 60 * 60 * 1000

    const groupA = Array.from({ length: samples }, (_, i) => {
      const noise = 1 + (Math.random() * variance * 2 - variance)
      return createTraceWithOptions({
        timestamp: baseTime + i * 2 * 60 * 60 * 1000,
        cost: groupACost * noise,
        duration: Math.floor(1000 * noise),
      })
    })

    const groupB = Array.from({ length: samples }, (_, i) => {
      const noise = 1 + (Math.random() * variance * 2 - variance)
      return createTraceWithOptions({
        timestamp: baseTime + i * 2 * 60 * 60 * 1000 + 60 * 60 * 1000,
        cost: groupBCost * noise,
        duration: Math.floor(1200 * noise),
      })
    })

    return { groupA, groupB }
  }

  /**
   * Generate noisy data - high variance around mean.
   * 
   * @param samples Number of samples
   * @param meanCost Mean cost (default: 0.02)
   * @param variance Variance percentage (default: 0.3 = 30%)
   */
  static noisy(
    samples: number,
    meanCost: number = 0.02,
    variance: number = 0.3
  ): Trace.Complete[] {
    const baseTime = Date.now() - samples * 60 * 60 * 1000

    return Array.from({ length: samples }, (_, i) => {
      const noise = 1 + (Math.random() * variance * 2 - variance)
      const timestamp = baseTime + i * 60 * 60 * 1000

      return createTraceWithOptions({
        timestamp,
        cost: Math.max(0.001, meanCost * noise), // Ensure positive
        duration: Math.floor(Math.max(100, 1000 * noise)),
      })
    })
  }

  /**
   * Generate step function - sudden change in performance.
   * 
   * Realistic scenario: Deployment, model update, infrastructure change
   * 
   * @param samplesBeforeStep Samples before the step
   * @param samplesAfterStep Samples after the step
   * @param beforeCost Cost before step (default: 0.02)
   * @param afterCost Cost after step (default: 0.04)
   */
  static stepFunction(
    samplesBeforeStep: number,
    samplesAfterStep: number,
    beforeCost: number = 0.02,
    afterCost: number = 0.04
  ): Trace.Complete[] {
    const totalSamples = samplesBeforeStep + samplesAfterStep
    const baseTime = Date.now() - totalSamples * 60 * 60 * 1000

    return Array.from({ length: totalSamples }, (_, i) => {
      const isAfterStep = i >= samplesBeforeStep
      const cost = isAfterStep ? afterCost : beforeCost
      const timestamp = baseTime + i * 60 * 60 * 1000

      return createTraceWithOptions({
        timestamp,
        cost,
        duration: Math.floor(cost * 50000),
      })
    })
  }
}
