import { debugBuild } from "@opencode/gui-plugins/debug/options"

/**
 * The remote debugging port, only in debug builds. The dev server opens 9222 unless told otherwise; Beta opens one only
 * when `OPENCODE_DESKTOP_REMOTE_DEBUGGING_PORT` names it. `0` lets Chromium pick a free port.
 */
export function remoteDebuggingPort(build: { readonly packaged: boolean; readonly channel: string }, value?: string) {
  if (!debugBuild(build)) return undefined

  if (value === undefined) return build.packaged ? undefined : "9222"

  if (!/^\d+$/.test(value)) return undefined

  return Number(value) <= 65535 ? String(Number(value)) : undefined
}
