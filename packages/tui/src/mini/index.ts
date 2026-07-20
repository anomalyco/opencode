import { runInteractiveDeferredMode, type RunDeferredInput } from "./runtime"

export type MiniFrontendInput = RunDeferredInput
export type MiniFrontendResult = {
  exitCode: number
}

export async function runMiniFrontend(input: MiniFrontendInput): Promise<MiniFrontendResult> {
  await runInteractiveDeferredMode(input)
  return { exitCode: 0 }
}
