import type { DataFlag } from "./flags"

/** Whether a data site feature flag (lib/flags.ts) is on in this build. */
export function dataFlag(key: DataFlag) {
  return (import.meta.env.DATA_FLAGS ?? "").split(",").includes(key)
}
