import { usePlatform } from "@/runtime/platform/platform"
import { useSshServers } from "./context"
import { createSshRestore } from "./restore-state"

export function SshRestore() {
  const platform = usePlatform()
  const ssh = useSshServers()
  createSshRestore({
    state: () => ssh.data,
    start: (input) => platform.sshServers?.start(input),
  })
  return null
}
