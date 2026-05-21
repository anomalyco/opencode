/**
 * Type definitions for Computer Use module.
 */

/** Screenshot result returned from Python helper. */
export interface ScreenshotResult {
  base64: string
  width: number
  height: number
  displayWidth: number
  displayHeight: number
  displayId?: number
  originX: number
  originY: number
}

/** Display geometry info. */
export interface DisplayGeometry {
  id: number
  displayId: number
  width: number
  height: number
  scaleFactor: number
  originX: number
  originY: number
  isPrimary: boolean
  name: string
  label: string
}

/** Permission check result. */
export interface PermissionStatus {
  accessibility: boolean
  screenRecording: boolean | null
}

/** App info returned from Python helper. */
export interface AppInfo {
  bundleId: string
  displayName: string
}

/** Frontmost app info. */
export interface FrontmostApp {
  bundleId: string
  displayName: string
}

/** Permission request for approval dialog. */
export interface PermissionRequest {
  apps: string[]
  reason: string
}

/** Permission response from user. */
export interface PermissionResponse {
  granted: string[]
  denied: string[]
}
