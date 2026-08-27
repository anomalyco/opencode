import { ClientError, isLocationDirectoryError, type LocationRef } from "../promise"

export type LocationSyncResource =
  | "info"
  | "vcs"
  | "agent"
  | "command"
  | "integration"
  | "mcp.server"
  | "mcp.resource"
  | "model"
  | "provider"
  | "reference"
  | "skill"
  | "shell"
  | "form"

/** A failed location read, not a claim that the directory is missing. */
export class LocationSyncError extends Error {
  override readonly name = "LocationSyncError"

  constructor(
    readonly location: LocationRef,
    readonly resource: LocationSyncResource,
    cause: unknown,
  ) {
    super(`Failed to sync ${resource} for ${location.directory}`, { cause })
  }

  get reason(): "missing" | "transport" | "location" | "resource" {
    if (
      this.resource === "info" &&
      isLocationDirectoryError(this.cause) &&
      this.cause.directory === this.location.directory
    )
      return "missing"
    if (this.cause instanceof ClientError && this.cause.reason === "Transport") return "transport"
    return this.resource === "info" ? "location" : "resource"
  }
}
