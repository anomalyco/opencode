/**
 * Time utilities for consistent timezone handling and timestamp operations.
 * 
 * All utilities use UTC to avoid timezone confusion.
 */

export namespace TimeUtils {
  /**
   * Extract hour of day in UTC.
   * Always uses UTC to avoid timezone confusion.
   */
  export function getHourOfDay(timestamp: number): number {
    return new Date(timestamp).getUTCHours()
  }

  /**
   * Get day of week in UTC (0 = Sunday, 6 = Saturday).
   */
  export function getDayOfWeek(timestamp: number): number {
    return new Date(timestamp).getUTCDay()
  }

  /**
   * Check if timestamp falls within business hours (UTC).
   * Default: 9am-5pm UTC (configurable)
   */
  export function isBusinessHours(
    timestamp: number,
    config = { startHour: 9, endHour: 17 }
  ): boolean {
    const hour = getHourOfDay(timestamp)
    return hour >= config.startHour && hour <= config.endHour
  }

  /**
   * Check if timestamp is a weekend (UTC).
   */
  export function isWeekend(timestamp: number): boolean {
    const day = getDayOfWeek(timestamp)
    return day === 0 || day === 6  // Sunday or Saturday
  }

  /**
   * Create evenly-spaced timestamps for simulation/testing.
   * 
   * @param startOrDaysAgo - Days ago (number) or specific start timestamp
   * @param endOrNow - Specific end timestamp or Date.now()
   * @param count - Number of timestamps to generate
   * @returns Array of evenly-spaced timestamps
   * 
   * @example
   * // Create 100 timestamps spanning last 7 days
   * const timestamps = createTimeRange(7, Date.now(), 100)
   * 
   * // Create 50 timestamps between two specific dates
   * const timestamps = createTimeRange(
   *   new Date('2024-01-01').getTime(),
   *   new Date('2024-01-31').getTime(),
   *   50
   * )
   */
  export function createTimeRange(
    startOrDaysAgo: number | Date,
    endOrNow: number | Date = Date.now(),
    count: number
  ): number[] {
    if (count < 2) {
      throw new Error('count must be at least 2')
    }

    const start = typeof startOrDaysAgo === 'number'
      ? Date.now() - startOrDaysAgo * 24 * 60 * 60 * 1000
      : startOrDaysAgo instanceof Date
      ? startOrDaysAgo.getTime()
      : startOrDaysAgo

    const end = typeof endOrNow === 'number'
      ? endOrNow
      : endOrNow instanceof Date
      ? endOrNow.getTime()
      : endOrNow

    if (start >= end) {
      throw new Error('start must be before end')
    }

    const step = (end - start) / (count - 1)

    return Array.from({ length: count }, (_, i) => Math.floor(start + i * step))
  }

  /**
   * Format timestamp for human-readable debugging.
   * 
   * @example
   * formatTimestamp(Date.now())
   * // "2024-01-15T10:30:00.000Z (0h ago)"
   * 
   * formatTimestamp(Date.now() - 3600000)
   * // "2024-01-15T09:30:00.000Z (1h ago)"
   */
  export function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp)
    const hoursAgo = Math.floor((Date.now() - timestamp) / (60 * 60 * 1000))
    
    if (hoursAgo < 0) {
      return `${date.toISOString()} (${Math.abs(hoursAgo)}h from now)`
    }
    if (hoursAgo === 0) {
      const minutesAgo = Math.floor((Date.now() - timestamp) / (60 * 1000))
      return `${date.toISOString()} (${minutesAgo}m ago)`
    }
    if (hoursAgo < 48) {
      return `${date.toISOString()} (${hoursAgo}h ago)`
    }
    const daysAgo = Math.floor(hoursAgo / 24)
    return `${date.toISOString()} (${daysAgo}d ago)`
  }

  /**
   * Validate timestamp is reasonable.
   * Throws if timestamp is clearly invalid.
   * Warns if timestamp is suspiciously far from now.
   * 
   * @param timestamp - Timestamp to validate
   * @param context - Context for error messages
   * @param options - Validation options
   * @returns The validated timestamp
   * 
   * @example
   * validateTimestamp(trace.createdAt, 'TimeSeries.record')
   * validateTimestamp(timestamp, 'test', { warnIfOlderThanDays: 30 })
   */
  export function validateTimestamp(
    timestamp: number,
    context: string,
    options: {
      warnIfOlderThanDays?: number
      warnIfNewerThanDays?: number
    } = {}
  ): number {
    // Check for obviously invalid values
    if (!timestamp || !Number.isFinite(timestamp)) {
      throw new Error(`Invalid timestamp in ${context}: ${timestamp}`)
    }

    if (timestamp <= 0) {
      throw new Error(`Timestamp must be positive in ${context}: ${timestamp}`)
    }

    // Check if timestamp is in milliseconds (not seconds)
    if (timestamp < 1000000000000) {
      throw new Error(
        `Timestamp appears to be in seconds, not milliseconds in ${context}: ${timestamp}. ` +
        `Did you mean ${timestamp * 1000}?`
      )
    }

    const now = Date.now()
    const ageMs = now - timestamp
    const ageDays = ageMs / (24 * 60 * 60 * 1000)

    // Warn if timestamp is from the future
    if (timestamp > now) {
      const futureDays = -ageDays
      const warnThreshold = options.warnIfNewerThanDays ?? 1
      
      if (futureDays > warnThreshold) {
        console.warn(
          `[TimeUtils] Timestamp is ${futureDays.toFixed(1)} days in the future. ` +
          `This might indicate a bug. Context: ${context}, Timestamp: ${formatTimestamp(timestamp)}`
        )
      }
    }

    // Warn if timestamp is very old
    const oldThreshold = options.warnIfOlderThanDays ?? 365
    if (ageDays > oldThreshold) {
      console.warn(
        `[TimeUtils] Timestamp is ${ageDays.toFixed(1)} days old (>${oldThreshold} days). ` +
        `This might indicate a bug. Context: ${context}, Timestamp: ${formatTimestamp(timestamp)}`
      )
    }

    return timestamp
  }

  /**
   * Round timestamp to nearest hour.
   * Useful for bucketing and aggregation.
   */
  export function roundToHour(timestamp: number): number {
    return Math.floor(timestamp / (60 * 60 * 1000)) * (60 * 60 * 1000)
  }

  /**
   * Round timestamp to nearest day.
   */
  export function roundToDay(timestamp: number): number {
    return Math.floor(timestamp / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000)
  }

  /**
   * Get start of day (00:00:00.000 UTC).
   */
  export function startOfDay(timestamp: number): number {
    const date = new Date(timestamp)
    date.setUTCHours(0, 0, 0, 0)
    return date.getTime()
  }

  /**
   * Get end of day (23:59:59.999 UTC).
   */
  export function endOfDay(timestamp: number): number {
    const date = new Date(timestamp)
    date.setUTCHours(23, 59, 59, 999)
    return date.getTime()
  }
}
