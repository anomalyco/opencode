import { runInteractiveDeferredMode, type RunDeferredInput } from "./runtime"

export type MiniFrontendInput = RunDeferredInput

export async function runMiniFrontend(input: MiniFrontendInput): Promise<void> {
  await runInteractiveDeferredMode(input)
}
