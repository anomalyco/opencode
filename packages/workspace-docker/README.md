# Docker workspace provider

This package boots opencode workspaces from an immutable Docker snapshot on the coordinator host. It is designed for a long-lived development VM such as `devbox`: Docker and every blueprint build, snapshot image, workspace container, and checkout stay inside that VM. The opencode coordinator and model loop stay outside the workspace containers and only control them.

A blueprint is the environment recipe; its build produces a frozen snapshot image. New root workspaces create fresh containers from that snapshot. The snapshot is never updated by a session. Forks use `docker commit --pause=true` to capture a mutable source workspace, create a child container from that temporary image, and immediately remove the temporary image tag. The repository must live in the container root filesystem; Docker volumes are intentionally not used because `docker commit` does not include them.

When a session already has a workspace, the built-in `subagent` tool forks it automatically. The child session receives the forked workspace ID and is instructed to commit its changes. Local sessions keep the existing shared-directory behavior.

Build a repository-specific blueprint into a deliberately versioned snapshot inside `devbox`:

```sh
docker build \
  -f packages/workspace-docker/blueprint/Dockerfile \
  --build-arg REPOSITORY=https://github.com/you/project.git \
  --build-arg REF=your-branch \
  --build-arg WORKSPACE_DIR=/absolute/path/used/by/the/coordinator \
  -t opencode-snapshot:v1 \
  .
```

Treat the resulting tag as immutable. When you intentionally change the base environment, build a new version instead of moving an existing tag. A Git repository is included here only because this example produces a ready-to-use project snapshot; Git is not part of workspace identity or forking.

The absolute checkout path must match the session location used by the coordinator. This keeps project discovery correct while all actual file and process operations run inside the container.

```ts
import { DockerWorkspace } from "@opencode-ai/workspace-docker"
import { OpenCode } from "@opencode-ai/sdk-next"
import { Effect } from "effect"

const program = Effect.gen(function* () {
  const docker = yield* DockerWorkspace.make({
    snapshot: "opencode-snapshot:v1",
    user: "1000:1000",
    cpus: 4,
    memory: "8g",
  })
  const opencode = yield* OpenCode.create({ workspaceProviders: { docker } })

  const base = yield* opencode.workspace.create({ provider: "docker" })
  const fork = yield* opencode.workspace.fork({ source: base.id })
  return { opencode, base, fork }
})
```

The coordinator needs access only to its local Docker daemon. Containers never receive the Docker socket, host mounts, or coordinator environment by default. Only environment variables explicitly attached to a child-process command cross the boundary. Set `network: "none"` when a task does not need network access.
