export class ShodanPermissionDeniedError extends Error {
  readonly operation: string
  readonly reason: string

  constructor(operation: string, reason: string) {
    super(`Shodan operation '${operation}' denied: ${reason}`)
    this.name = "ShodanPermissionDeniedError"
    this.operation = operation
    this.reason = reason
  }
}

/**
 * Operations that ALWAYS require explicit confirmation.
 * These are the high-risk operations that scan or stream live internet data.
 */
export const HIGH_RISK_OPERATIONS = new Set([
  "scan",
  "crawlForPort",
  "banners",
  "bannersWithinAsns",
  "bannersWithinCountries",
  "bannersOnPorts",
  "alerts",
  "alert",
])

/**
 * Operations that require confirmation but are lower risk (read-only queries).
 */
export const MODERATE_RISK_OPERATIONS = new Set([
  "hostSearch",
  "hostInfo",
  "hostCount",
  "exploitsSearch",
  "exploitsCount",
])

/**
 * Checks whether an operation is allowed given the provided explicit approval.
 *
 * @param operation - The Shodan operation being attempted
 * @param explicitlyApproved - Whether the user has explicitly approved this specific call
 * @throws {ShodanPermissionDeniedError} if not approved
 */
export function assertPermission(
  operation: string,
  explicitlyApproved: boolean,
): void {
  if (!explicitlyApproved) {
    if (HIGH_RISK_OPERATIONS.has(operation)) {
      throw new ShodanPermissionDeniedError(
        operation,
        "This is a HIGH RISK operation that actively scans or streams live internet data. " +
          "Explicit user approval is required. Pass approved: true only after the user has confirmed.",
      )
    }
    if (MODERATE_RISK_OPERATIONS.has(operation)) {
      throw new ShodanPermissionDeniedError(
        operation,
        "This operation queries live internet intelligence data. " +
          "Explicit user approval is required. Pass approved: true only after the user has confirmed.",
      )
    }
  }
}
