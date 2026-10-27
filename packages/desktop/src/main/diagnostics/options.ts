import { debugBuild } from "@opencode/gui-plugins/debug/options"

/**
 * The remote debugging port, only in debug builds. The dev server opens 9222 unless
 * `OPENCODE_DESKTOP_REMOTE_DEBUGGING_PORT` names another. `0` lets Chromium pick a free port.
 */
export function remoteDebuggingPort(build: { readonly packaged: boolean; readonly channel: string }, value?: string) {
  if (!debugBuild(build)) return undefined

  if (value === undefined) return "9222"

  if (!/^\d+$/.test(value)) return undefined

  return Number(value) <= 65535 ? String(Number(value)) : undefined
}
