export * as GlobalFlags from "./global-flags"

import { Flag, GlobalFlag } from "effect/unstable/cli"

export const CpuProfile = GlobalFlag.setting("cpu-profile")({
  flag: Flag.string("cpu-profile").pipe(
    Flag.withDescription("Write a CPU profile to this path when the process stops"),
    Flag.optional,
  ),
})

export const all = [CpuProfile] as const
