import { useCloneProgress as useForkCloneProgress } from "@opencode-ai/fork-ui"
import type { CloneProgressPlatform, CloneProgressServer } from "@opencode-ai/fork-ui"
import type { CloneAuthType, UseCloneProgressOptions, UseCloneProgressReturn } from "@opencode-ai/fork-ui"
import { useServer } from "@/context/server"
import { usePlatform } from "@/context/platform"

export type { CloneAuthType, UseCloneProgressOptions, UseCloneProgressReturn }

export function useCloneProgress(options: UseCloneProgressOptions): UseCloneProgressReturn {
  const server = useServer()
  const platform = usePlatform()
  return useForkCloneProgress(options, {
    server: server as CloneProgressServer,
    platform: platform as CloneProgressPlatform,
  })
}
