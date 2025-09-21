import type { SpawnOptions } from "bun"

// Define the full args type (using Bun's internal spawn types)
export type TuiCmdArgsType = SpawnOptions.OptionsObject<"inherit", "inherit", "inherit"> & {
  cmd: string[]
}

// Define and export the args object
export let TuiCmdArgs: TuiCmdArgsType = {
  cmd: [],
}

// Setter function with correct types
export function SetTuiCmdArgs(args: TuiCmdArgsType): void {
  TuiCmdArgs = args
}
