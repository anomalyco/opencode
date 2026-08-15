# Incus workspace provider

This package turns an Incus container or VM into an opencode workspace. New workspaces copy a stopped blueprint instance; forks copy an existing workspace. All child processes and default filesystem operations cross `incus exec`, so the coordinator does not need a shared checkout.

The blueprint and workspace instances may be containers or VMs. Containers fork faster; VMs provide a stronger kernel boundary.

When a session already has a workspace, the built-in `subagent` tool snapshots and forks it automatically. The child session receives the forked workspace ID and is instructed to commit its changes. Local sessions keep the existing shared-directory behavior.

```ts
import { IncusWorkspace } from "@opencode-ai/workspace-incus"
import { OpenCode } from "@opencode-ai/sdk-next"
import { Effect } from "effect"

const program = Effect.gen(function* () {
  const incus = yield* IncusWorkspace.make({
    remote: "IncusMini",
    project: "opencode",
    blueprint: "opencode-blueprint",
    user: 1000,
    group: 1000,
  })
  const opencode = yield* OpenCode.create({ workspaceProviders: { incus } })

  const base = yield* opencode.workspace.create({ provider: "incus" })
  const fork = yield* opencode.workspace.fork({ source: base.id })
  return { opencode, base, fork }
})
```

The coordinator needs the `incus` CLI and access to the configured remote/project. Use a dedicated Incus project and a restricted client certificate or broker; do not give the coordinator unrestricted access to the Incus server.

The blueprint should be stopped and should contain the repository at the same absolute path used in session locations. It also needs the tools agents will invoke (`git`, a POSIX shell, coreutils, language runtimes, and project dependencies). No provider credentials are copied into workspace bindings or forwarded from the coordinator environment; only environment variables explicitly attached to each child-process command cross the boundary.

Forks take a temporary Incus snapshot before copying, then remove it. The project therefore needs permission to create snapshots. Workspace bindings contain only the remote, project, instance name, lifecycle state, and format version.
