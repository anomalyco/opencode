import type { RootLoadArgs } from "./types"

export async function loadRootSessions(input: RootLoadArgs) {
  // Cache all roots for a directory. Sidebar components own visible limits, so
  // the shared directory store must not be clipped by whichever view loads first.
  const result = await input.list({ directory: input.directory, roots: true })
  return {
    data: result.data,
  } as const
}
