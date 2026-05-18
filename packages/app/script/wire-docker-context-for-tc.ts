import { spawnSync } from "node:child_process"

function emit(msg: string) {
  if (process.env.OPENCODE_E2E_LOG === "1") process.stderr.write(`${msg}\n`)
}

/**
 * When `DOCKER_HOST` is unset, copy the active `docker context` Unix socket into the env so **Node**
 * (Testcontainers, Bun, Vitest workers) hits the same daemon as the `docker` CLI — e.g. **Colima**
 * (`unix://~/.colima/.../docker.sock`) instead of assuming `/var/run/docker.sock` (Docker Desktop).
 *
 * Also sets `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE` when unset so Ryuk mounts the daemon socket (see
 * https://node.testcontainers.org/configuration ). For **Colima**, the client socket lives under
 * `~/.colima/...` on macOS, but Ryuk’s bind mount source must be the path **on the Docker host**
 * (`/var/run/docker.sock` inside the Colima VM), not the macOS tunnel path (otherwise Docker returns
 * 500 when creating the mount).
 *
 * **Reuse:** `TESTCONTAINERS_REUSE_ENABLE` is driven by `useE2eStack` / `startE2eDockerDeps({ reuse })`, not here.
 *
 * Skip entirely with `OPENCODE_SKIP_DOCKER_CONTEXT_WIRE=1`.
 */
export function wireDockerContextForTc() {
  if (process.env.OPENCODE_SKIP_DOCKER_CONTEXT_WIRE === "1") return

  let name = ""
  try {
    const show = spawnSync("docker", ["context", "show"], { encoding: "utf8", timeout: 8000 })
    if (show.status !== 0) return
    name = show.stdout?.trim() ?? ""
  } catch {
    return
  }

  if (process.env.DOCKER_HOST) {
    const h = process.env.DOCKER_HOST.trim()
    if (process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE === undefined && h.startsWith("unix://")) {
      const s = h.replace(/^unix:\/\//, "")
      const colima = s.includes("/.colima/") || h.includes(".colima/")
      process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE = colima ? "/var/run/docker.sock" : s
    }
    emit(
      `[e2e-docker] context=${name || "?"} DOCKER_HOST preset ${process.env.DOCKER_HOST} override=${process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE ?? "(unset)"}`,
    )
    return
  }

  let host = ""
  try {
    if (!name) return
    const ins = spawnSync("docker", ["context", "inspect", name, "--format", "{{.Endpoints.docker.Host}}"], {
      encoding: "utf8",
      timeout: 8000,
    })
    if (ins.status !== 0) return
    host = ins.stdout?.trim() ?? ""
  } catch {
    return
  }

  if (!host.startsWith("unix://")) {
    emit(`[e2e-docker] context=${name} endpoint=${host || "(empty)"} (skip unix wire)`)
    return
  }

  const sock = host.replace(/^unix:\/\//, "")
  if (!sock) return

  process.env.DOCKER_HOST = host
  if (process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE === undefined) {
    const colima = sock.includes("/.colima/") || host.includes(".colima/")
    process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE = colima ? "/var/run/docker.sock" : sock
  }

  emit(
    `[e2e-docker] context=${name} DOCKER_HOST=${host} TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=${process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE}`,
  )
}
