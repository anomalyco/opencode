import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import {
  controlPath,
  initializeManifest,
  listInstances,
  manifestPath,
  register,
  unregister,
  type InstanceManifest,
} from "../../src/instance/registry.js"
import { createResponseSettings, generateResponse } from "../../src/cli/response-generator.js"
import { CommandBatchError, executeCommands } from "../../src/cli/commands.js"
import { splitText } from "../../src/cli/mock-backend.js"
import { resolveSendEndpoint } from "../../src/cli/send.js"
import { sendError, sendResult, startTransportPeer } from "../simulation/transport-peer.js"

const roots: string[] = []
const instances: Array<{ root: string; name: string }> = []

setDefaultTimeout(30_000)

afterEach(async () => {
  await Promise.all(
    instances.splice(0).map(async ({ root, name }) => {
      await spawn(["stop", "--name", name], root).exited
    }),
  )
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("opencode-drive", () => {
  test("rejects unsupported optional UI commands without sending them", async () => {
    const peers = [
      startTransportPeer(
        ({ request, socket }) => {
          if (request.method !== "simulation.handshake") return
          const params = request.params as {
            readonly requiredCapabilities: ReadonlyArray<string>
          }
          sendResult(socket, request, {
            protocolVersion: 1,
            role: "ui",
            server: { name: "opencode", version: "older" },
            capabilities: params.requiredCapabilities,
          })
        },
        { handshake: false },
      ),
      startTransportPeer(
        ({ request, socket }) => {
          if (request.method === "simulation.handshake") sendError(socket, request, "method not found", -32601)
        },
        { handshake: false },
      ),
    ]

    try {
      for (const peer of peers) {
        for (const expected of [
          {
            command: { operation: "ui.snapshot" as const },
            method: "ui.snapshot",
            message: "ui.snapshot is not available on this OpenCode endpoint",
          },
          {
            command: {
              operation: "ui.click" as const,
              value: JSON.stringify({
                target: 3,
                x: 1,
                y: 0,
                semantic: {
                  id: "session.permission.action.once",
                  instance: "permission-1",
                  element: 3,
                },
              }),
            },
            method: "ui.click",
            message: "semantic ui.click is not available on this OpenCode endpoint",
          },
        ]) {
          const result = executeCommands(peer.url, [expected.command])
          await expect(result).rejects.toMatchObject({
            name: "CommandBatchError",
            reason: {
              name: "SimulationError",
              method: expected.method,
              message: expected.message,
            },
          } satisfies Partial<CommandBatchError>)
        }
        expect(peer.received.map(({ request }) => request.method)).toEqual([
          "simulation.handshake",
          "simulation.handshake",
        ])
      }
    } finally {
      await Promise.all(peers.map((peer) => peer.stop()))
    }
  })

  test("requires an explicit name to initialize or start headless", async () => {
    const root = await temporary()
    for (const command of ["init", "start"]) {
      const child = spawn([command], root)
      expect(await child.exited).toBe(1)
      expect(await new Response(child.stderr).text()).toContain("--name")
    }
  })

  test("initializes artifacts and starts from the prepared instance", async () => {
    const root = await temporary()
    const name = "initialized-test"
    const initialized = spawn(["init", "--name", name], root)
    const [initStatus, initOutput] = await Promise.all([initialized.exited, new Response(initialized.stdout).text()])
    expect(initStatus).toBe(0)
    const artifacts = initOutput.trim()
    expect(await Bun.file(join(artifacts, "files", ".opencode", "opencode.jsonc")).exists()).toBe(true)
    expect(
      Bun.JSONC.parse(await Bun.file(join(artifacts, "files", ".opencode", "opencode.jsonc")).text()),
    ).toMatchObject({
      model: "simulation/gpt-sim-model",
      snapshots: false,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      providers: {
        simulation: {
          package: "@opencode-ai/ai/providers/openai/chat",
          settings: { apiKey: "sim-key" },
          models: { "gpt-sim-model": { capabilities: { tools: true } } },
        },
      },
    })
    expect(await Bun.file(join(artifacts, "drive", "name")).text()).toBe(`${name}\n`)
    expect(await Bun.file(join(root, "registry", `${name}.json`)).json()).toMatchObject({
      name,
      artifacts,
      status: "initialized",
    })
    const repeated = spawn(["init", "--name", name], root)
    expect(await repeated.exited).toBe(0)
    expect((await new Response(repeated.stdout).text()).trim()).toBe(artifacts)
    const listed = spawn(["list"], root)
    expect(await listed.exited).toBe(0)
    expect(await new Response(listed.stdout).text()).toBe(`${name}: ${join(root, "registry", `${name}.json`)}\n`)

    await Bun.write(join(artifacts, "prepared.txt"), "prepared before start\n")
    const started = spawn(["start", "--name", name, "--", process.execPath, fixture("fake-opencode.ts")], root)
    const [startStatus, startError] = await Promise.all([started.exited, new Response(started.stderr).text()])
    expect(startStatus).toBe(0)
    expect(startError).toContain(`opencode-drive: using artifacts ${artifacts}`)
    instances.push({ root, name })
    expect(await Bun.file(join(artifacts, "prepared.txt")).text()).toBe("prepared before start\n")
    expect(await Bun.file(join(root, "registry", `${name}.json`)).json()).toMatchObject({
      name,
      artifacts,
      status: "ready",
    })
  })

  test("starts, drives, prints dir, restarts, and stops a named detached instance", async () => {
    const root = await temporary()
    const name = "detached-test"
    const started = spawn(
      ["start", "--name", name, "--record", "--", process.execPath, fixture("fake-opencode.ts")],
      root,
    )
    const [startStatus, startError] = await Promise.all([started.exited, new Response(started.stderr).text()])
    expect(startStatus).toBe(0)
    expect(startError).toContain("opencode-drive: using artifacts ")
    const startArtifacts = artifactPath(startError)
    expect(startError).toContain(
      `opencode-drive: opencode instance logs: ${join(startArtifacts, "logs", "opencode", "log", "opencode*.log")}`,
    )
    expect(startError).toContain(
      `opencode-drive: current run script logs: ${join(startArtifacts, "logs", "opencode-drive.log")}`,
    )
    expect(startError).not.toContain(`opencode-drive: ${name}`)
    instances.push({ root, name })

    const manifest = await Bun.file(join(root, "registry", `${name}.json`)).json()
    expect(manifest.visible).toBe(false)
    expect(manifest.endpoints.ui).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/)
    expect(manifest.endpoints.backend).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/)

    const state = spawn(["send", "--name", name, "--command.ui.state"], root)
    expect(await state.exited).toBe(0)
    expect(JSON.parse(await new Response(state.stdout).text()).focused.editor).toBe(true)

    const snapshot = spawn(["send", "--name", name, "--command.ui.snapshot"], root)
    expect(await snapshot.exited).toBe(0)
    expect(JSON.parse(await new Response(snapshot.stdout).text())).toMatchObject({
      format: "opencode-ui-snapshot-v1",
      nodes: [{ id: "prompt", role: "textbox", element: 1 }],
    })

    const matches = spawn(["send", "--name", name, "--command.ui.matches", '{"text":"Fake OpenCode"}'], root)
    expect(await matches.exited).toBe(0)
    expect(await new Response(matches.stdout).text()).toBe("true\n")

    const literal = spawn(["send", "--name", name, "--command.ui.matches", '{"text":"Fake.*OpenCode"}'], root)
    expect(await literal.exited).toBe(0)
    expect(await new Response(literal.stdout).text()).toBe("false\n")

    const screenshot = spawn(["send", "--name", name, "--command.ui.screenshot"], root)
    expect(await screenshot.exited).toBe(0)
    const screenshotPath = (await new Response(screenshot.stdout).text()).trim()
    expect(dirname(screenshotPath)).toBe(runOutputDirectory(root, manifest.artifacts, 0))
    expect(basename(screenshotPath).startsWith("screenshot-")).toBe(true)
    expect(screenshotPath.endsWith(".png")).toBe(true)

    const listed = spawn(["dir", "--name", name], root)
    expect(await listed.exited).toBe(0)
    expect(await new Response(listed.stdout).text()).toBe(`${manifest.artifacts}\n`)
    const driveLog = join(manifest.artifacts, "logs", "opencode-drive.log")
    const driveLogText = await Bun.file(driveLog).text()
    expect(driveLogText).toContain("INFO ready detached-test")
    expect(driveLogText).toContain(
      `INFO opencode instance logs: ${join(manifest.artifacts, "logs", "opencode", "log", "opencode*.log")}`,
    )
    expect(driveLogText).toContain(`INFO current run script logs: ${driveLog}`)
    expect(driveLogText).toContain("INFO ui command ui.state params=undefined")
    expect(driveLogText).toContain('INFO ui command ui.matches params={"text":"Fake OpenCode"}')

    const restarted = spawn(["restart", "--name", name], root)
    expect(await restarted.exited).toBe(0)
    const restartedRecording = (await new Response(restarted.stdout).text()).trim()
    expect(dirname(restartedRecording)).toBe(runOutputDirectory(root, manifest.artifacts, 0))
    expect(basename(restartedRecording)).toMatch(/^recording-.*\.mp4$/)
    expect(await Bun.file(restartedRecording).exists()).toBe(true)
    await waitForLines(join(manifest.artifacts, "launches.txt"), 2)
    expect(await spawn(["send", "--name", name, "--command.ui.state"], root).exited).toBe(0)

    const stopped = spawn(["stop", "--name", name], root)
    const [stoppedStatus, stoppedOutput, stoppedError] = await Promise.all([
      stopped.exited,
      new Response(stopped.stdout).text(),
      new Response(stopped.stderr).text(),
    ])
    expect(stoppedStatus).toBe(0)
    expect(stoppedOutput).toBe("")
    const stoppedRecording = stoppedError.match(/Video successfully created: (.+\.mp4)/)?.[1]
    expect(stoppedRecording).toBeDefined()
    expect(dirname(stoppedRecording!)).toBe(runOutputDirectory(root, manifest.artifacts, 1))
    expect(basename(stoppedRecording!)).toMatch(/^recording-.*\.mp4$/)
    expect(await Bun.file(stoppedRecording!).exists()).toBe(true)
    expect(stoppedError).toContain("Rendering video: 10%")
    expect(stoppedError).toContain("Rendering video: 100%")
    expect(stoppedError).toContain(`Video successfully created: ${stoppedRecording}`)
    expect(await Bun.file(join(root, "registry", `${name}.json`)).exists()).toBe(false)
    expect(await Bun.file(manifest.artifacts).exists()).toBe(false)
    instances.splice(
      instances.findIndex((item) => item.name === name),
      1,
    )
  }, 60_000)

  test("exports a completed timeline after the OpenCode child exits", async () => {
    const root = await temporary()
    const name = "exited-recording-test"
    const started = spawn(
      ["start", "--name", name, "--record", "--", process.execPath, fixture("fake-opencode.ts"), "exit-after-attach"],
      root,
    )
    const [status, stderr] = await Promise.all([started.exited, new Response(started.stderr).text()])
    expect(status, stderr).toBe(0)
    const artifacts = stderr.match(/opencode-drive: using artifacts (.+)/)?.[1]
    expect(artifacts).toBeDefined()

    const deadline = Date.now() + 10_000
    while (await Bun.file(join(root, "registry", `${name}.json`)).exists()) {
      if (Date.now() >= deadline) throw new Error("timed out waiting for exited instance cleanup")
      await Bun.sleep(25)
    }
    const directory = runOutputDirectory(root, artifacts!, 0)
    const files = await readdir(directory)
    const video = files.find((file) => file.endsWith(".mp4"))
    expect(video).toBeDefined()
    expect(await Bun.file(join(directory, video!)).size).toBeGreaterThan(500)
  }, 15_000)

  test("does not record unless start receives --record", async () => {
    const root = await temporary()
    const name = "no-recording-test"
    expect(
      await spawn(["start", "--name", name, "--", process.execPath, fixture("fake-opencode.ts")], root).exited,
    ).toBe(0)
    instances.push({ root, name })
    const manifest = await Bun.file(join(root, "registry", `${name}.json`)).json()
    const drive = await Bun.file(join(manifest.artifacts, "drive", `${name}.json`)).json()
    expect(drive.recording).toBeUndefined()

    const stopped = spawn(["stop", "--name", name], root)
    expect(await stopped.exited).toBe(0)
    expect(await new Response(stopped.stdout).text()).toBe("success\n")
    expect(await Bun.file(join(root, "output")).exists()).toBe(false)
    expect(await Bun.file(manifest.artifacts).exists()).toBe(false)
    instances.pop()
  })

  test("rejects duplicate names", async () => {
    const root = await temporary()
    const name = "duplicate-test"
    const args = ["start", "--name", name, "--", process.execPath, fixture("fake-opencode.ts")]
    expect(await spawn(args, root).exited).toBe(0)
    instances.push({ root, name })
    const duplicate = spawn(args, root)
    const [status, stderr] = await Promise.all([duplicate.exited, new Response(duplicate.stderr).text()])
    expect(status).toBe(1)
    expect(stderr).toContain(`drive instance "${name}" is already running`)
  })

  test(
    "only the owning detached launcher starts an automatic instance",
    () => expectSingleConcurrentStart(false),
    75_000,
  )

  test("only the owning detached launcher starts a prepared instance", () => expectSingleConcurrentStart(true), 75_000)

  test("registers only one concurrent owner for a name", async () => {
    const root = await temporary()
    await withRegistry(root, async () => {
      const results = await Promise.allSettled([
        register(testManifest("racing", process.pid)),
        register(testManifest("racing", process.pid)),
      ])
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    })
  })

  test("transfers temporary initialization only to its declared daemon", async () => {
    const root = await temporary()
    const owner = Bun.spawn([process.execPath, "-e", "await Bun.sleep(60_000)"])
    try {
      await withRegistry(root, async () => {
        const name = "temporary-owner"
        const artifacts = join(root, "artifacts")
        await mkdir(join(root, "registry"), { recursive: true })
        await Bun.write(
          manifestPath(name),
          `${JSON.stringify({
            version: 1,
            name,
            createdAt: new Date().toISOString(),
            cwd: root,
            artifacts,
            status: "initialized",
            temporary: true,
            pid: owner.pid,
          })}\n`,
        )
        const create = async () => {
          throw new Error("existing initialization was replaced")
        }

        await expect(initializeManifest(name, root, create, { temporary: true })).rejects.toThrow(
          `drive instance "${name}" is already starting`,
        )
        owner.kill()
        await owner.exited
        expect(
          await initializeManifest(name, root, create, {
            temporary: true,
            adoptPid: owner.pid,
          }),
        ).toMatchObject({ pid: process.pid, artifacts })
        await expect(register(testManifest(name, owner.pid))).rejects.toThrow(
          `drive instance "${name}" changed ownership`,
        )
      })
    } finally {
      if (owner.exitCode === null) owner.kill()
      await owner.exited
    }
  })

  test("preserves prepared artifacts when reclaiming a dead launcher", async () => {
    const root = await temporary()
    await withRegistry(root, async () => {
      const name = "prepared-owner"
      const artifacts = join(root, "prepared-artifacts")
      await mkdir(join(root, "registry"), { recursive: true })
      await Bun.write(
        manifestPath(name),
        `${JSON.stringify({
          version: 1,
          name,
          createdAt: new Date().toISOString(),
          cwd: root,
          artifacts,
          status: "initialized",
          pid: 2_000_000_000,
        })}\n`,
      )

      const create = async () => {
        throw new Error("prepared artifacts were replaced")
      }
      const released = await initializeManifest(name, root, create)
      expect(released).toMatchObject({ artifacts })
      expect("pid" in released).toBe(false)
      expect("pid" in (await Bun.file(manifestPath(name)).json())).toBe(false)

      const reclaimed = await initializeManifest(name, root, create, { temporary: true })
      expect(reclaimed).toMatchObject({ pid: process.pid, artifacts })
      expect("temporary" in reclaimed).toBe(false)
    })
  })

  test("registers only one visible instance", async () => {
    const root = await temporary()
    await withRegistry(root, async () => {
      await register({
        ...testManifest("first-visible", process.pid),
        visible: true,
      })
      await expect(
        register({
          ...testManifest("second-visible", process.pid),
          visible: true,
        }),
      ).rejects.toThrow('visible drive instance "first-visible" is already running')
    })
  })

  test("falls back to the default UI endpoint when no visible instance is registered", async () => {
    const root = await temporary()
    await withRegistry(root, async () => {
      await register(testManifest("headless", process.pid))
      expect(await resolveSendEndpoint()).toBe("ws://127.0.0.1:40900")
    })
  })

  test("does not let a stale owner remove its replacement", async () => {
    const root = await temporary()
    await withRegistry(root, async () => {
      const stalePid = 2_000_000_000
      await register(testManifest("replacement", stalePid))
      await register(testManifest("replacement", process.pid))
      await unregister("replacement", stalePid)
      expect((await Bun.file(manifestPath("replacement")).json()).pid).toBe(process.pid)
    })
  })

  test("refuses to drive an instance that is still starting", async () => {
    const root = await temporary()
    await withRegistry(root, () => register(testManifest("starting", process.pid, "starting")))
    const child = spawn(["send", "--name", "starting", "--command.ui.state"], root)
    const [status, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(status).toBe(1)
    expect(stderr).toContain('drive instance "starting" is still starting')
  })

  test("lists sorted active instances and prunes stale state", async () => {
    const root = await temporary()
    await withRegistry(root, async () => {
      await register(testManifest("zeta", process.pid))
      await register(testManifest("alpha", process.pid))
      await register(testManifest("stale", 2_000_000_000))
      await Bun.write(controlPath("orphan"), "")
      expect((await listInstances()).map((manifest) => manifest.name)).toEqual(["alpha", "zeta"])
      expect(await Bun.file(manifestPath("stale")).exists()).toBe(false)
      expect(await Bun.file(controlPath("stale")).exists()).toBe(false)
      expect(await Bun.file(controlPath("orphan")).exists()).toBe(false)
    })
    const listed = spawn(["list"], root)
    expect(await listed.exited).toBe(0)
    expect(await new Response(listed.stdout).text()).toBe(
      `alpha: ${join(root, "registry", "alpha.json")}\nzeta: ${join(root, "registry", "zeta.json")}\n`,
    )
  })

  test("prunes dead transient initialized manifests", async () => {
    const root = await temporary()
    await withRegistry(root, async () => {
      const stalePid = 2_000_000_000
      await Bun.write(
        manifestPath("temporary-initialized"),
        `${JSON.stringify({
          version: 1,
          name: "temporary-initialized",
          createdAt: new Date().toISOString(),
          cwd: root,
          artifacts: join(root, "opencode-drive", "run-temporary"),
          status: "initialized",
          temporary: true,
          pid: stalePid,
        })}\n`,
      )
      await Bun.write(
        manifestPath("visible-12345"),
        `${JSON.stringify({
          version: 1,
          name: "visible-12345",
          createdAt: new Date().toISOString(),
          cwd: root,
          artifacts: join(root, "opencode-drive", "run-visible"),
          status: "initialized",
        })}\n`,
      )

      expect(await listInstances()).toEqual([])
      expect(await Bun.file(manifestPath("temporary-initialized")).exists()).toBe(false)
      expect(await Bun.file(manifestPath("visible-12345")).exists()).toBe(false)
    })
  })

  test("prunes artifact directories not referenced by active sessions", async () => {
    const root = await temporary()
    const artifactsRoot = join(root, "opencode-drive")
    const active = join(artifactsRoot, "run-active")
    const initialized = join(artifactsRoot, "run-initialized")
    const visible = join(artifactsRoot, "run-visible")
    const stale = join(artifactsRoot, "run-stale")
    const unrelated = join(artifactsRoot, "other")
    await Promise.all(
      [active, initialized, visible, stale, unrelated].map((directory) =>
        Bun.write(join(directory, "marker.txt"), "artifact\n"),
      ),
    )
    await withRegistry(root, async () => {
      await register({
        ...testManifest("active", process.pid),
        artifacts: active,
      })
      await Bun.write(
        manifestPath("initialized"),
        `${JSON.stringify({
          version: 1,
          name: "initialized",
          createdAt: new Date().toISOString(),
          cwd: root,
          artifacts: initialized,
          status: "initialized",
        })}\n`,
      )
      await Bun.write(
        manifestPath("visible-12345"),
        `${JSON.stringify({
          version: 1,
          name: "visible-12345",
          createdAt: new Date().toISOString(),
          cwd: root,
          artifacts: visible,
          status: "initialized",
        })}\n`,
      )
    })

    const child = spawn(["prune"], root)
    expect(await child.exited).toBe(0)
    expect(await new Response(child.stdout).text()).toBe("2\n")
    expect(await Bun.file(join(active, "marker.txt")).exists()).toBe(true)
    expect(await Bun.file(join(initialized, "marker.txt")).exists()).toBe(true)
    expect(await Bun.file(join(visible, "marker.txt")).exists()).toBe(false)
    expect(await Bun.file(join(stale, "marker.txt")).exists()).toBe(false)
    expect(await Bun.file(join(unrelated, "marker.txt")).exists()).toBe(true)
  })

  test("prunes one named inactive artifact directory", async () => {
    const root = await temporary()
    const artifactsRoot = join(root, "opencode-drive")
    const active = join(artifactsRoot, "run-active")
    const staleA = join(artifactsRoot, "run-stale-a")
    const staleB = join(artifactsRoot, "run-stale-b")
    await Promise.all(
      [active, staleA, staleB].map((directory) => Bun.write(join(directory, "marker.txt"), "artifact\n")),
    )
    await Promise.all([
      Bun.write(join(active, "drive", "name"), "active\n"),
      Bun.write(join(staleA, "drive", "name"), "stale-a\n"),
      Bun.write(join(staleB, "drive", "name"), "stale-b\n"),
    ])
    await withRegistry(root, async () => {
      await register({
        ...testManifest("active", process.pid),
        artifacts: active,
      })
    })

    const child = spawn(["prune", "--name", "stale-a"], root)
    expect(await child.exited).toBe(0)
    expect(await new Response(child.stdout).text()).toBe("1\n")
    expect(await Bun.file(join(active, "marker.txt")).exists()).toBe(true)
    expect(await Bun.file(join(staleA, "marker.txt")).exists()).toBe(false)
    expect(await Bun.file(join(staleB, "marker.txt")).exists()).toBe(true)
  })

  test("force prunes matching active artifact directories", async () => {
    const root = await temporary()
    const artifactsRoot = join(root, "opencode-drive")
    const active = join(artifactsRoot, "run-active")
    const stale = join(artifactsRoot, "run-stale")
    await Promise.all([active, stale].map((directory) => Bun.write(join(directory, "marker.txt"), "artifact\n")))
    await Promise.all([
      Bun.write(join(active, "drive", "name"), "active\n"),
      Bun.write(join(stale, "drive", "name"), "stale\n"),
    ])
    await withRegistry(root, async () => {
      await register({
        ...testManifest("active", process.pid),
        artifacts: active,
      })
    })

    const child = spawn(["prune", "--name", "active", "--force"], root)
    expect(await child.exited).toBe(0)
    expect(await new Response(child.stdout).text()).toBe("1\n")
    expect(await Bun.file(join(active, "marker.txt")).exists()).toBe(false)
    expect(await Bun.file(join(stale, "marker.txt")).exists()).toBe(true)
  })

  test("force prunes all artifact directories", async () => {
    const root = await temporary()
    const artifactsRoot = join(root, "opencode-drive")
    const active = join(artifactsRoot, "run-active")
    const initialized = join(artifactsRoot, "run-initialized")
    const stale = join(artifactsRoot, "run-stale")
    const unrelated = join(artifactsRoot, "other")
    await Promise.all(
      [active, initialized, stale, unrelated].map((directory) =>
        Bun.write(join(directory, "marker.txt"), "artifact\n"),
      ),
    )
    await withRegistry(root, async () => {
      await register({
        ...testManifest("active", process.pid),
        artifacts: active,
      })
      await Bun.write(
        manifestPath("initialized"),
        `${JSON.stringify({
          version: 1,
          name: "initialized",
          createdAt: new Date().toISOString(),
          cwd: root,
          artifacts: initialized,
          status: "initialized",
        })}\n`,
      )
    })

    const child = spawn(["prune", "--force"], root)
    expect(await child.exited).toBe(0)
    expect(await new Response(child.stdout).text()).toBe("3\n")
    expect(await Bun.file(join(active, "marker.txt")).exists()).toBe(false)
    expect(await Bun.file(join(initialized, "marker.txt")).exists()).toBe(false)
    expect(await Bun.file(join(stale, "marker.txt")).exists()).toBe(false)
    expect(await Bun.file(join(unrelated, "marker.txt")).exists()).toBe(true)
  })

  test("reports optional-name discovery errors", async () => {
    const root = await temporary()
    const missing = spawn(["dir"], root)
    expect(await missing.exited).toBe(1)
    expect(await new Response(missing.stderr).text()).toContain("no drive instances are running")
  })

  test("runs multiple named instances concurrently", async () => {
    const root = await temporary()
    const names = ["first", "second"] as const
    const starts = names.map((name) =>
      spawn(["start", "--name", name, "--", process.execPath, fixture("fake-opencode.ts")], root),
    )
    expect(await Promise.all(starts.map((child) => child.exited))).toEqual([0, 0])
    instances.push(...names.map((name) => ({ root, name })))
    const first = await Bun.file(join(root, "registry", "first.json")).json()
    const second = await Bun.file(join(root, "registry", "second.json")).json()
    expect(first.endpoints.ui).not.toBe(second.endpoints.ui)
    expect(await spawn(["send", "--name", "first", "--command.ui.state"], root).exited).toBe(0)
    expect(await spawn(["send", "--name", "second", "--command.ui.state"], root).exited).toBe(0)
    const screenshots = await Promise.all(
      [first, second].map(async (manifest, index) => {
        const name = index === 0 ? "first" : "second"
        const screenshot = spawn(["send", "--name", name, "--command.ui.screenshot", '{"name":"shared"}'], root)
        expect(await screenshot.exited).toBe(0)
        return (await new Response(screenshot.stdout).text()).trim()
      }),
    )
    expect(screenshots).toEqual([
      join(runOutputDirectory(root, first.artifacts, 0), "shared.png"),
      join(runOutputDirectory(root, second.artifacts, 0), "shared.png"),
    ])

    const unnamed = spawn(["dir"], root)
    const [status, stderr] = await Promise.all([unnamed.exited, new Response(unnamed.stderr).text()])
    expect(status).toBe(1)
    expect(stderr).toContain("no visible drive instance is running; pass --name (first, second)")
    const listed = spawn(["list"], root)
    expect(await listed.exited).toBe(0)
    expect(await new Response(listed.stdout).text()).toBe(
      `first: ${join(root, "registry", "first.json")}\nsecond: ${join(root, "registry", "second.json")}\n`,
    )
  })

  test("surfaces the owner log when detached startup fails", async () => {
    const root = await temporary()
    const name = "failed-start"
    const child = spawn(["start", "--name", name, "--", process.execPath, "-e", "process.exit(7)"], root)
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(status).toBe(1)
    expect(stderr).toContain(`see ${join(root, "registry", `${name}.log`)}`)
    expect(await Bun.file(join(root, "registry", `${name}.log`)).text()).toContain("OpenCode exited with status 7")
  })

  test("makes the visible instance the nameless target", async () => {
    const root = await temporary()
    const background = "background"
    const backgroundStart = spawn(
      ["start", "--name", background, "--", process.execPath, fixture("fake-opencode.ts")],
      root,
    )
    const [backgroundStatus, backgroundError] = await Promise.all([
      backgroundStart.exited,
      new Response(backgroundStart.stderr).text(),
    ])
    expect(backgroundStatus).toBe(0)
    instances.push({ root, name: background })

    const running = spawn(["start", "--visible", "--", process.execPath, fixture("fake-opencode.ts"), "30000"], root)
    const name = `visible-${running.pid}`
    const manifest = await waitForManifest(root, name)
    instances.push({ root, name: manifest.name })
    expect(manifest.visible).toBe(true)

    const state = spawn(["send", "--command.ui.state"], root)
    expect(await state.exited).toBe(0)
    expect(JSON.parse(await new Response(state.stdout).text()).focused.editor).toBe(true)

    expect(await spawn(["stop"], root).exited).toBe(0)
    instances.pop()
    expect(await running.exited).toBe(0)
    expect(await spawn(["stop", "--name", background], root).exited).toBe(0)
    instances.pop()
    const listed = spawn(["list"], root)
    expect(await listed.exited).toBe(0)
    expect(await new Response(listed.stdout).text()).toBe("\n")
  })

  test("blocks and stops the instance after a script completes", async () => {
    const root = await temporary()
    const name = "script-test"
    const child = spawn(
      ["start", "--name", name, "--script", fixture("script.ts"), "--", process.execPath, fixture("fake-opencode.ts")],
      root,
    )
    const started = Date.now()
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(status).toBe(0)
    expect(Date.now() - started).toBeLessThan(10_000)
    const artifacts = artifactPath(stderr)
    expect(await Bun.file(join(artifacts, "script-result.json")).json()).toMatchObject({
      frame: { cols: 80, rows: 24 },
      gitWriteError: expect.stringContaining("must not modify Git metadata"),
      matches: true,
    })
    expect(
      Bun.JSONC.parse(await Bun.file(join(artifacts, "files", ".opencode", "opencode.jsonc")).text()),
    ).toMatchObject({
      autoupdate: false,
      model: "simulation/gpt-sim-model",
      providers: { simulation: { models: { "gpt-sim-model": {} } } },
      test: { declared: true, setup: true },
    })
    expect(Bun.JSONC.parse(await Bun.file(join(artifacts, "files", ".opencode", "tui.jsonc")).text())).toEqual({
      test: { declared: true, setup: true },
    })
    const backendEvents = (await Bun.file(join(artifacts, "backend-events.jsonl")).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(
      backendEvents
        .filter((event) => event.method === "llm.chunk")
        .flatMap((event) => event.params.items)
        .filter((item) => item.type === "textDelta")
        .map((item) => item.text)
        .join(""),
    ).toBe("script response")
    expect(backendEvents.filter((event) => event.method === "llm.chunk").length).toBeGreaterThan(1)
    expect(
      backendEvents
        .filter((event) => event.method === "llm.chunk")
        .flatMap((event) => event.params.items)
        .every((item) => item.type !== "textDelta" || item.text.length <= 8),
    ).toBe(true)
    expect(backendEvents.filter((event) => event.method === "llm.finish")).toEqual([
      { method: "llm.finish", params: { id: "ex_mock", reason: "stop" } },
    ])
    expect(await Bun.file(join(artifacts, "seeded-at-launch.txt")).text()).toBe("export const seeded = true\n")
    expect(await Bun.file(join(artifacts, "files", "setup-seeded.txt")).text()).toBe("included in baseline\n")
    expect(await Bun.$`git status --porcelain`.cwd(join(artifacts, "files")).text()).toBe("")
    expect((await Bun.$`git log -1 --format=%s`.cwd(join(artifacts, "files")).text()).trim()).toBe("Initial commit")
    expect(await realpath(await Bun.file(join(artifacts, "child-cwd.txt")).text())).toBe(
      await realpath(join(artifacts, "files")),
    )
    expect(await Bun.file(join(artifacts, "service-argv.json")).json()).toEqual([
      "serve",
      "--service",
      "--port",
      expect.stringMatching(/^\d+$/),
    ])
    const pid = Number(await Bun.file(join(artifacts, "child.pid")).text())
    expect(running(pid)).toBe(false)
    expect(await Bun.file(join(root, "registry", `${name}.json`)).exists()).toBe(false)
  })

  test("protects Git metadata in prepared project scripts", async () => {
    const root = await temporary()
    const name = "prepared-git-script-test"
    const initialized = spawn(["init", "--name", name], root)
    expect(await initialized.exited).toBe(0)
    const artifacts = (await new Response(initialized.stdout).text()).trim()
    const files = join(artifacts, "files")
    await rm(join(files, ".git"), { recursive: true })
    await Bun.$`git init --quiet --initial-branch=main`.cwd(files)
    await Bun.$`git add --all`.cwd(files)
    await Bun.$`git -c user.name=Fixture -c user.email=fixture@example.com commit --quiet --message=Prepared`.cwd(files)
    const gitConfig = await Bun.file(join(files, ".git", "config")).text()

    const started = spawn(["start", "--name", name, "--script", fixture("prepared-git-script.ts")], root)
    expect(await started.exited).toBe(0)
    expect(await Bun.file(join(artifacts, "prepared-git-result.json")).json()).toEqual({
      runGitError: expect.stringContaining("must not modify Git metadata"),
      setupGitError: expect.stringContaining("must not modify Git metadata"),
    })
    expect(await Bun.file(join(files, ".git", "config")).text()).toBe(gitConfig)
    expect((await Bun.$`git log -1 --format=%s`.cwd(files).text()).trim()).toBe("Prepared")
  }, 10_000)

  test("cleans artifacts after a successful scripted run", async () => {
    const root = await temporary()
    const name = "script-cleanup-test"
    const child = spawn(
      ["start", "--name", name, "--script", fixture("script.ts"), "--", process.execPath, fixture("fake-opencode.ts")],
      root,
      { keepArtifacts: false },
    )
    const [status, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(status).toBe(0)
    const artifacts = artifactPath(stderr)
    expect(await Bun.file(artifacts).exists()).toBe(false)
    expect(await Bun.file(join(root, "registry", `${name}.json`)).exists()).toBe(false)
  })

  test("aborts the script run when a UI wait times out even if the script catches it", async () => {
    const root = await temporary()
    const name = "caught-timeout-test"
    const child = spawn(
      [
        "start",
        "--name",
        name,
        "--script",
        fixture("caught-timeout-script.ts"),
        "--",
        process.execPath,
        fixture("fake-opencode.ts"),
      ],
      root,
    )
    const [status, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(status).toBe(1)
    const artifacts = artifactPath(stderr)
    expect(stderr).toContain('timed out waiting for the UI to match "this text never appears"')
    expect(await Bun.file(join(root, "registry", `${name}.json`)).exists()).toBe(false)
  }, 10_000)

  test("stops the whole run when a script crashes", async () => {
    const root = await temporary()
    const name = "crashing-script-test"
    const child = spawn(
      [
        "start",
        "--name",
        name,
        "--script",
        fixture("crashing-script.ts"),
        "--",
        process.execPath,
        fixture("fake-opencode.ts"),
      ],
      root,
    )
    const [status, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(status).toBe(1)
    const artifacts = artifactPath(stderr)
    expect(stderr).toContain("script crashed")
    expect(await Bun.file(join(root, "registry", `${name}.json`)).exists()).toBe(false)
    const pid = Number(await Bun.file(join(artifacts, "child.pid")).text())
    expect(running(pid)).toBe(false)
    const pruned = spawn(["prune", "--name", name], root)
    expect(await pruned.exited).toBe(0)
    expect(await new Response(pruned.stdout).text()).toBe("1\n")
    expect(await Bun.file(artifacts).exists()).toBe(false)
  })

  test("checks a typed script without modifying its source directory", async () => {
    const root = await temporary()
    const directory = join(root, "scripts")
    await mkdir(directory, { recursive: true })
    await Bun.write(
      join(directory, "valid.ts"),
      'import { Effect } from "effect"\nimport { defineScript } from "opencode-drive"\nexport default defineScript({ project: { git: true, files: { "src/index.ts": "export {}\\n" } }, run: () => Effect.sleep(1) })\n',
    )
    const checked = spawn(["check", join(directory, "valid.ts")], root)
    expect(await checked.exited).toBe(0)
    expect(await Bun.file(join(directory, "node_modules", "opencode-drive")).exists()).toBe(false)
    expect(await Bun.file(join(directory, "node_modules", ".bin", "tsgo")).exists()).toBe(false)
    expect(await Bun.file(join(directory, "node_modules")).exists()).toBe(false)

    await Bun.write(join(directory, "invalid.ts"), 'import { Effect } from "effect"\nEffect.sleep("wrong")\n')
    const invalid = spawn(["check", join(directory, "invalid.ts")], root)
    const invalidError = new Response(invalid.stderr).text()
    expect(await invalid.exited).toBe(1)
    expect(await invalidError).toContain("is not assignable to parameter of type")

    await Bun.write(
      join(directory, "plain-object.ts"),
      'import { Effect } from "effect"\nexport default { run: () => Effect.void }\n',
    )
    const plainObject = spawn(["check", join(directory, "plain-object.ts")], root)
    expect(await plainObject.exited).toBe(1)
    expect(await new Response(plainObject.stderr).text()).toContain("kind")

    await Bun.write(
      join(directory, "promise.ts"),
      'import { defineScript } from "opencode-drive"\nexport default defineScript({ run: async ({ ui }) => { await ui.submit("Hello") } })\n',
    )
    const promise = spawn(["check", join(directory, "promise.ts")], root)
    const promiseError = new Response(promise.stderr).text()
    expect(await promise.exited).toBe(1)
    expect(await promiseError).toContain("OpenCode Drive scripts are Effect-only")
    expect(await promiseError).toContain("Effect.gen(function* ()")
  }, 60_000)

  test("runs a script imported from the Drive source checkout", async () => {
    const root = await temporary()
    const name = "source-script-test"
    const child = spawn(
      [
        "start",
        "--name",
        name,
        "--script",
        fixture("source-script.ts"),
        "--",
        process.execPath,
        fixture("fake-opencode.ts"),
      ],
      root,
    )
    const [status, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])

    expect(status).toBe(0)
    expect(stderr).not.toContain("Failed to register capture font")
  }, 10_000)

  test("creates a type-checkable Effect script without overwriting it", async () => {
    const root = await temporary()
    const file = join(root, "scripts", "drive.ts")
    const created = spawn(["script", "init", file], root)
    const [status, stdout] = await Promise.all([created.exited, new Response(created.stdout).text()])
    expect(status).toBe(0)
    expect(stdout.trim()).toBe(file)
    const source = await Bun.file(file).text()
    expect(source).toContain('import { defineScript, Effect, Llm } from "opencode-drive"')
    expect(source).toContain('llm.queue(Llm.text("The value is 1."))')

    const checked = spawn(["check", file], root)
    expect(await checked.exited).toBe(0)

    const repeated = spawn(["script", "init", file], root)
    expect(await repeated.exited).toBe(1)
    expect(await new Response(repeated.stderr).text()).toContain("script already exists")
    expect(await Bun.file(file).text()).toBe(source)
  }, 60_000)

  test("launches all TUIs explicitly for a manual UI script", async () => {
    const root = await temporary()
    const name = "manual-clients-test"
    const child = spawn(
      [
        "start",
        "--name",
        name,
        "--script",
        fixture("manual-clients-script.ts"),
        "--",
        process.execPath,
        fixture("fake-opencode.ts"),
      ],
      root,
    )
    const stderr = new Response(child.stderr).text()
    expect(await child.exited).toBe(0)
    const error = await stderr
    const artifacts = artifactPath(error)
    expect(await Bun.file(join(artifacts, "manual-clients.json")).json()).toEqual({
      apiHealthy: true,
      aliceFrame: { cols: 80, rows: 24 },
      aliceMatches: true,
      bobMatches: true,
      tuiBeforeServer: "launch the script server before launching TUIs",
      duplicateServer: "the script server has already been launched",
      aliceScreenshot: join(runOutputDirectory(root, artifacts, 0), "alice.png"),
      bobScreenshot: join(runOutputDirectory(root, artifacts, 0), "bob.png"),
    })
    expect((await Bun.file(join(artifacts, "launches.txt")).text()).trim().split("\n")).toHaveLength(2)
  }, 60_000)

  test("controls a statically declared tool from the running script", async () => {
    const root = await temporary()
    const child = spawn(
      [
        "start",
        "--name",
        "tool-control-script-test",
        "--script",
        fixture("tool-control-script.ts"),
        "--",
        process.execPath,
        fixture("fake-opencode.ts"),
      ],
      root,
    )
    const stderr = new Response(child.stderr).text()
    expect(await child.exited).toBe(0)
    const artifacts = artifactPath(await stderr)
    const events = (await Bun.file(join(artifacts, "tool-control-events.jsonl")).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(events).toEqual([
      { type: "progress", result: { output: "script progress\n" } },
      { type: "success", result: { output: "script success\n", exit: 0 } },
    ])
  }, 60_000)

  test("closes the automatic script's primary TUI", async () => {
    const root = await temporary()
    const child = spawn(
      [
        "start",
        "--name",
        "kill-primary-test",
        "--script",
        fixture("kill-primary-script.ts"),
        "--",
        process.execPath,
        fixture("fake-opencode.ts"),
      ],
      root,
    )
    const stderr = new Response(child.stderr).text()
    expect(await child.exited).toBe(0)
  }, 60_000)

  test("kills and relaunches the scripted server and TUIs", async () => {
    const root = await temporary()
    const child = spawn(
      [
        "start",
        "--name",
        "kill-server-test",
        "--script",
        fixture("kill-server-script.ts"),
        "--",
        process.execPath,
        fixture("fake-opencode.ts"),
      ],
      root,
    )
    const stderr = new Response(child.stderr).text()
    expect(await child.exited).toBe(0)
    const error = await stderr
    const artifacts = artifactPath(error)
    const result = await Bun.file(join(artifacts, "kill-server-result.json")).json()
    expect(Number.isInteger(result.firstServer)).toBe(true)
    expect(Number.isInteger(result.secondServer)).toBe(true)
    expect(result.secondServer).not.toBe(result.firstServer)
    expect(dirname(result.aliceRecording)).toBe(runOutputDirectory(root, artifacts, 0))
    expect(basename(result.aliceRecording)).toMatch(/^recording-.*\.mp4$/)
    expect(await Bun.file(result.aliceRecording).exists()).toBe(true)
    const recordings = [...error.matchAll(/opencode-drive: recording (.+\.mp4)/g)].map((match) => match[1]!)
    expect(recordings).toHaveLength(2)
    expect(await Promise.all(recordings.map((path) => Bun.file(path).exists()))).toEqual([true, true])
    expect((await Bun.file(join(artifacts, "launches.txt")).text()).trim().split("\n")).toHaveLength(3)
  }, 60_000)

  test("retries a launch that fails after LLM attachment", async () => {
    const root = await temporary()
    const child = spawn(
      [
        "start",
        "--name",
        "failed-launch-retry-test",
        "--script",
        fixture("failed-launch-retry-script.ts"),
        "--",
        process.execPath,
        fixture("fake-opencode.ts"),
        "omit-service-registration",
      ],
      root,
    )
    const stderr = new Response(child.stderr).text()
    expect(await child.exited).toBe(0)
    const artifacts = artifactPath(await stderr)
    const result = await Bun.file(join(artifacts, "failed-launch-retry.json")).json()
    expect(Number.isInteger(result.firstPid)).toBe(true)
    expect(Number.isInteger(result.secondPid)).toBe(true)
    expect(result.secondPid).not.toBe(result.firstPid)
  }, 60_000)

  test("rejects the removed callback script shape", async () => {
    const root = await temporary()
    const child = spawn(["start", "--name", "callback-script-test", "--script", fixture("callback-script.ts")], root)
    expect(await child.exited).toBe(1)
    expect(await new Response(child.stderr).text()).toContain("script must default-export defineScript(...)")
  })

  test("does not apply primary TUI options to additional TUIs", async () => {
    const root = await temporary()
    const child = spawn(
      [
        "start",
        "--name",
        "tui-options-test",
        "--script",
        fixture("tui-options-script.ts"),
        "--",
        process.execPath,
        fixture("fake-opencode.ts"),
      ],
      root,
    )
    const stderr = new Response(child.stderr).text()
    expect(await child.exited).toBe(0)
    const artifacts = artifactPath(await stderr)
    expect(await Bun.file(join(artifacts, "tui-options.json")).json()).toEqual({
      primaryRecording: true,
      secondaryRecording: false,
    })
  })

  test.each(["setup", "run"] as const)("rejects a Promise-returning script %s callback", async (callback) => {
    const root = await temporary()
    const script = join(root, `promise-${callback}-script.js`)
    await Bun.write(
      script,
      callback === "setup"
        ? `import { Effect } from "effect"\nimport { defineScript } from "opencode-drive"\nexport default defineScript({ setup: async () => {}, run: () => Effect.void })\n`
        : `import { defineScript } from "opencode-drive"\nexport default defineScript({ run: async () => {} })\n`,
    )
    const child = spawn(
      [
        "start",
        "--name",
        `promise-${callback}-script-test`,
        "--script",
        script,
        "--",
        process.execPath,
        fixture("fake-opencode.ts"),
      ],
      root,
    )
    expect(await child.exited).toBe(1)
    expect(await new Response(child.stderr).text()).toContain(
      callback === "setup" ? "setup must return an Effect" : "script run must return an Effect",
    )
  })

  test("rejects a Promise-returning UI predicate", async () => {
    const root = await temporary()
    const script = join(root, "promise-predicate-script.js")
    await Bun.write(
      script,
      `import { defineScript } from "opencode-drive"\nexport default defineScript({ run: ({ ui }) => ui.waitFor(() => Promise.resolve(false)) })\n`,
    )
    const child = spawn(
      [
        "start",
        "--name",
        "promise-predicate-script-test",
        "--script",
        script,
        "--",
        process.execPath,
        fixture("fake-opencode.ts"),
      ],
      root,
    )
    expect(await child.exited).toBe(1)
    expect(await new Response(child.stderr).text()).toContain("ui.waitFor predicate must return a boolean or Effect")
  })

  test("stops a visible instance after a script completes", async () => {
    const root = await temporary()
    const name = "visible-script-test"
    const child = spawn(
      [
        "start",
        "--visible",
        "--name",
        name,
        "--script",
        fixture("script.ts"),
        "--",
        process.execPath,
        fixture("fake-opencode.ts"),
      ],
      root,
    )
    expect(await child.exited).toBe(0)
    expect(await Bun.file(join(root, "registry", `${name}.json`)).exists()).toBe(false)
  })

  test("keeps service and progress output out of a visible client terminal", async () => {
    const root = await temporary()
    const child = spawn(
      [
        "start",
        "--visible",
        "--name",
        "visible-output-test",
        "--script",
        fixture("script.ts"),
        "--",
        process.execPath,
        fixture("fake-opencode.ts"),
        "stdio-markers",
      ],
      root,
    )
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(status).toBe(0)
    expect(stdout).toContain("fake-client-stdout")
    expect(stdout).not.toContain("fake-service-stdout")
    expect(stderr).toContain("fake-client-stderr")
    expect(stderr).not.toContain("fake-service-stderr")
    expect(stderr).not.toContain("script completed")

    const artifacts = artifactPath(stderr)
    expect(await Bun.file(join(artifacts, "logs", "service.stdout.log")).text()).toContain("fake-service-stdout")
    expect(await Bun.file(join(artifacts, "logs", "service.stderr.log")).text()).toContain("fake-service-stderr")
    expect(await Bun.file(join(artifacts, "logs", "opencode-drive.log")).text()).toContain("script completed")
  })

  test.each(["title-requests", "latest-title-requests"])(
    "routes %s outside the normal LLM response sequence",
    async (mode) => {
      const root = await temporary()
      const child = spawn(
        [
          "start",
          "--name",
          "title-script-test",
          "--script",
          fixture("title-script.ts"),
          "--",
          process.execPath,
          fixture("fake-opencode.ts"),
          mode,
        ],
        root,
      )
      const stderr = new Response(child.stderr).text()
      expect(await child.exited).toBe(0)
      const artifacts = artifactPath(await stderr)
      const events = (await Bun.file(join(artifacts, "backend-events.jsonl")).text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      const text = (id: string) =>
        events
          .filter((event) => event.method === "llm.chunk" && event.params.id === id)
          .flatMap((event) => event.params.items)
          .filter((item) => item.type === "textDelta")
          .map((item) => item.text)
          .join("")
      expect(text("ex_title")).toBe("Custom title")
      expect(text("ex_mock")).toBe("Normal response")
    },
  )

  test("serves typed LLM chunks and preserves an explicit finish", async () => {
    const root = await temporary()
    const child = spawn(
      [
        "start",
        "--name",
        "serve-script-test",
        "--script",
        fixture("serve-script.ts"),
        "--",
        process.execPath,
        fixture("fake-opencode.ts"),
      ],
      root,
    )
    const stderr = new Response(child.stderr).text()
    expect(await child.exited).toBe(0)
    const artifacts = artifactPath(await stderr)
    const events = (await Bun.file(join(artifacts, "backend-events.jsonl")).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(
      events
        .filter((event) => event.method === "llm.chunk")
        .flatMap((event) => event.params.items)
        .filter((item) => item.type === "textDelta")
        .map((item) => item.text)
        .join(""),
    ).toBe("served response")
    expect(
      events
        .filter((event) => event.method === "llm.chunk")
        .flatMap((event) => event.params.items)
        .filter((item) => item.type === "reasoningDelta")
        .map((item) => item.text)
        .join(""),
    ).toBe("thinking")
    expect(events.filter((event) => event.method === "llm.finish")).toEqual([
      { method: "llm.finish", params: { id: "ex_mock", reason: "length" } },
    ])
  })

  test("waits for a delayed request to accept a sent LLM response", async () => {
    const root = await temporary()
    const child = spawn(
      [
        "start",
        "--name",
        "delayed-queue-test",
        "--script",
        fixture("script.ts"),
        "--",
        process.execPath,
        fixture("fake-opencode.ts"),
        "10000",
        "250",
      ],
      root,
    )
    expect(await child.exited).toBe(0)
  })

  test("restarts an active scripted run", async () => {
    const root = await temporary()
    const name = "restart-script-test"
    const owner = spawn(
      [
        "start",
        "--name",
        name,
        "--script",
        fixture("restart-script.ts"),
        "--",
        process.execPath,
        fixture("fake-opencode.ts"),
      ],
      root,
    )
    const manifest = await waitForManifest(root, name)
    await waitForLines(join(manifest.artifacts, "script-runs.txt"), 1)

    expect(await spawn(["restart", "--name", name], root).exited).toBe(0)
    await waitForLines(join(manifest.artifacts, "script-runs.txt"), 2)
    const screenshots = (await Bun.file(join(manifest.artifacts, "script-screenshots.txt")).text()).trim().split("\n")
    expect(screenshots).toEqual([
      join(runOutputDirectory(root, manifest.artifacts, 0), "restart-shared.png"),
      join(runOutputDirectory(root, manifest.artifacts, 1), "restart-shared.png"),
    ])
    expect(await spawn(["stop", "--name", name], root).exited).toBe(0)
    expect(await owner.exited).toBe(0)
  })

  test("stops a hanging script after the OpenCode child exits", async () => {
    const root = await temporary()
    const name = "exited-script-test"
    const child = spawn(
      [
        "start",
        "--name",
        name,
        "--script",
        fixture("hanging-script.ts"),
        "--",
        process.execPath,
        fixture("fake-opencode.ts"),
        "500",
      ],
      root,
    )
    expect(await child.exited).toBe(0)
    expect(await Bun.file(join(root, "registry", `${name}.json`)).exists()).toBe(false)
  })

  test("waits for script cancellation and lifecycle cleanup on interruption", async () => {
    const root = await temporary()
    const name = "interrupted-script-test"
    const script = join(root, "interrupted-script.ts")
    const marker = join(root, "script-interrupted")
    await Bun.write(
      script,
      `import { Effect } from "effect"\nimport { defineScript } from "opencode-drive"\nexport default defineScript({ run: ({ artifacts }) => Effect.never.pipe(Effect.ensuring(Effect.promise(async () => { const pid = Number(await Bun.file(artifacts + "/child.pid").text()); let running = true; try { process.kill(pid, 0) } catch { running = false }; await Bun.write(${JSON.stringify(marker)}, running ? "child-running\\n" : "child-stopped\\n") }))) })\n`,
    )
    const child = spawn(
      ["start", "--daemon", "--name", name, "--script", script, "--", process.execPath, fixture("fake-opencode.ts")],
      root,
    )
    const manifest = await waitForManifest(root, name)
    const openCodePid = Number(await Bun.file(join(manifest.artifacts, "child.pid")).text())

    process.kill(child.pid, "SIGTERM")
    await child.exited

    expect(await Bun.file(marker).text()).toBe("child-running\n")
    expect(running(openCodePid)).toBe(false)
    expect(await Bun.file(join(root, "registry", `${name}.json`)).exists()).toBe(false)
    expect(await Bun.file(join(root, "registry", `${name}.sock`)).exists()).toBe(false)
    expect(await Bun.file(join(root, "node_modules", "opencode-drive")).exists()).toBe(false)
    expect(await Bun.file(join(root, "node_modules")).exists()).toBe(false)
  })

  test("finalizes recording before interrupted owner teardown completes", async () => {
    const root = await temporary()
    const name = "interrupted-recording-test"
    const child = spawn(
      ["start", "--daemon", "--name", name, "--record", "--", process.execPath, fixture("fake-opencode.ts")],
      root,
    )
    const manifest = await waitForManifest(root, name)

    process.kill(child.pid, "SIGTERM")
    await child.exited

    expect((await readdir(runOutputDirectory(root, manifest.artifacts, 0))).some((file) => file.endsWith(".mp4"))).toBe(
      true,
    )
    expect(await Bun.file(join(root, "registry", `${name}.json`)).exists()).toBe(false)
    expect(await Bun.file(join(root, "registry", `${name}.sock`)).exists()).toBe(false)
  }, 60_000)

  test("rejects removed LLM commands", async () => {
    const root = await temporary()
    expect(await spawn(["send", "--command.llm.pending"], root).exited).toBe(1)
  })

  test("generates configured tool calls from offered schemas", () => {
    const settings = createResponseSettings()
    settings.update({ types: ["tool"], tools: ["read"] })
    const tools = [
      {
        type: "function",
        function: {
          name: "shell",
          parameters: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "read",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
              offset: { type: "integer" },
              limit: { type: "integer" },
            },
            required: ["path", "offset", "limit"],
          },
        },
      },
    ]
    const response = generateResponse(settings.current(), {
      id: "ex_1",
      url: "https://api.openai.com/v1/chat/completions",
      body: { tools },
    })
    expect(response.finish).toBe("tool-calls")
    expect(response.items).toEqual([
      {
        type: "toolCall",
        index: 0,
        id: expect.stringMatching(/^call_[a-f0-9]{16}$/),
        name: "read",
        input: {
          path: ".opencode/opencode.jsonc",
          offset: 1,
          limit: 120,
        },
      },
    ])

    settings.update({ types: ["tool"], tools: ["shell", "read"] })
    const multiple = generateResponse(settings.current(), {
      id: "ex_2",
      url: "https://api.openai.com/v1/chat/completions",
      body: { tools },
    })
    expect(multiple.items).toHaveLength(2)
    expect(multiple.items).toMatchObject([
      { type: "toolCall", index: 0, name: "shell" },
      { type: "toolCall", index: 1, name: "read" },
    ])
  })

  test("generates patches and finishes tool continuations with text", () => {
    const settings = createResponseSettings()
    settings.update({ types: ["diff"], tools: ["apply_patch"] })
    const body = {
      tools: [
        {
          type: "function",
          function: {
            name: "apply_patch",
            parameters: {
              type: "object",
              properties: { patchText: { type: "string" } },
              required: ["patchText"],
            },
          },
        },
      ],
    }
    const response = generateResponse(settings.current(), {
      id: "ex_1",
      url: "https://api.openai.com/v1/chat/completions",
      body,
    })
    expect(response.finish).toBe("tool-calls")
    expect(response.items[0]).toMatchObject({
      type: "toolCall",
      name: "apply_patch",
      input: {
        patchText: expect.stringMatching(/\n-export function greet\([^)]+\)[\s\S]+\n\+export function greet\(/),
      },
    })

    const continuation = generateResponse(settings.current(), {
      id: "ex_2",
      url: "https://api.openai.com/v1/chat/completions",
      body: { ...body, messages: [{ role: "tool", content: "done" }] },
    })
    expect(continuation.finish).toBe("stop")
    expect(continuation.items[0]).toMatchObject({ type: "textDelta" })

    const laterTurn = generateResponse(settings.current(), {
      id: "ex_later",
      url: "https://api.openai.com/v1/chat/completions",
      body: {
        ...body,
        messages: [
          { role: "tool", content: "done" },
          { role: "assistant", content: "Finished." },
          { role: "user", content: "Make another change." },
        ],
      },
    })
    expect(laterTurn.finish).toBe("tool-calls")

    settings.update({ types: ["diff"], tools: ["edit", "write"] })
    const write = generateResponse(settings.current(), {
      id: "ex_3",
      url: "https://api.openai.com/v1/chat/completions",
      body: {
        tools: [
          {
            type: "function",
            function: {
              name: "edit",
              parameters: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  oldString: { type: "string" },
                  newString: { type: "string" },
                },
                required: ["path", "oldString", "newString"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "write",
              parameters: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  content: { type: "string" },
                },
                required: ["path", "content"],
              },
            },
          },
        ],
      },
    })
    expect(write.items[0]).toMatchObject({
      type: "toolCall",
      name: "write",
      input: {
        path: "src/garden.js",
        content: expect.stringContaining("export function greet"),
      },
    })
  })

  test("splits generated prose into small streaming chunks", () => {
    const text = "Mushrooms gather quietly while flowers map the path home."
    const chunks = splitText(text)
    expect(chunks.join("")).toBe(text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.trim().split(/\s+/).length <= 3)).toBe(true)
  })
})

function spawn(args: ReadonlyArray<string>, root: string, options: { readonly keepArtifacts?: boolean } = {}) {
  const env = {
    ...process.env,
    DRIVE_REGISTRY_DIR: join(root, "registry"),
    OPENCODE_DRIVE_MEDIA_DIR: join(root, "output"),
    OPENCODE_DRIVE_KEEP_ARTIFACTS: "1",
    TMPDIR: root,
  }
  if (options.keepArtifacts === false) delete env.OPENCODE_DRIVE_KEEP_ARTIFACTS
  return Bun.spawn([process.execPath, resolve("src/cli/index.ts"), ...args], {
    cwd: resolve("."),
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
}

function fixture(name: string) {
  return resolve("test", "fixtures", name)
}

function runOutputDirectory(root: string, artifacts: string, generation: number) {
  return join(root, "output", basename(artifacts), `generation-${generation}`)
}

async function temporary() {
  const root = await mkdtemp(join(tmpdir(), "opencode-drive-test-"))
  roots.push(root)
  return root
}

async function waitForLines(file: string, count: number) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const lines = await Bun.file(file)
      .text()
      .then((text) => text.trim().split("\n").length)
      .catch(() => 0)
    if (lines >= count) return
    await Bun.sleep(25)
  }
  throw new Error(`timed out waiting for ${count} lines in ${file}`)
}

async function waitForManifest(root: string, name: string, timeout = 10_000) {
  const file = join(root, "registry", `${name}.json`)
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const manifest = await Bun.file(file)
      .json()
      .catch(() => undefined)
    if (manifest?.status === "ready") return manifest as InstanceManifest
    await Bun.sleep(25)
  }
  throw new Error(`timed out waiting for ${file}`)
}

async function waitForLauncher(child: ReturnType<typeof spawn>, stderr: Promise<string>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), 10_000)
  })
  try {
    const status = await Promise.race([child.exited, timeout])
    if (status !== "timeout") return status
    if (child.exitCode === null) child.kill()
    await child.exited
    throw new Error(`launcher ${child.pid} did not exit after ownership resolved: ${await stderr}`)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function expectSingleConcurrentStart(prepared: boolean) {
  const root = await temporary()
  const name = `concurrent-start-${prepared ? "prepared" : "automatic"}`
  if (prepared) expect(await spawn(["init", "--name", name], root).exited).toBe(0)
  const args = ["start", "--name", name, "--", process.execPath, fixture("fake-opencode.ts")]
  const children = [spawn(args, root), spawn(args, root)]
  const stderr = children.map((child) => new Response(child.stderr).text())
  let managed = false
  try {
    const manifest = await waitForManifest(root, name, 65_000)
    instances.push({ root, name })
    managed = true
    const statuses = await Promise.all(children.map((child, index) => waitForLauncher(child, stderr[index]!)))
    const errors = await Promise.all(stderr)
    expect(statuses.sort()).toEqual([0, 1])
    expect(errors.filter((error) => error.includes("is already starting"))).toHaveLength(1)
    expect(errors.some((error) => error.includes("detached instance exited"))).toBe(false)
    expect(manifest.pid).toBeGreaterThan(0)
  } finally {
    await Promise.all(
      children.map(async (child) => {
        if (child.exitCode === null) child.kill()
        await child.exited
      }),
    )
    await Promise.allSettled(stderr)
    if (!managed) await terminateUnmanagedInstance(root, name)
  }
}

async function terminateUnmanagedInstance(root: string, name: string) {
  const manifest: unknown = await Bun.file(join(root, "registry", `${name}.json`))
    .json()
    .catch(() => undefined)
  if (typeof manifest !== "object" || manifest === null || !("pid" in manifest) || typeof manifest.pid !== "number")
    return
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    if (!running(manifest.pid)) return
    try {
      process.kill(manifest.pid, signal)
    } catch (error) {
      if (!running(manifest.pid)) return
      throw error
    }
    const deadline = Date.now() + 2_000
    while (running(manifest.pid) && Date.now() < deadline) await Bun.sleep(25)
  }
  if (running(manifest.pid)) throw new Error(`failed to terminate drive owner ${manifest.pid}`)
}

async function waitForMissing(file: string) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (!(await Bun.file(file).exists())) return
    await Bun.sleep(25)
  }
  throw new Error(`timed out waiting for ${file} removal`)
}

function artifactPath(stderr: string) {
  const line = stderr.split("\n").find((value) => value.startsWith("opencode-drive: using artifacts "))
  if (!line) throw new Error("artifact path was not reported")
  return line.slice("opencode-drive: using artifacts ".length)
}

function running(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function testManifest(name: string, pid: number, status: "starting" | "ready" = "ready") {
  return {
    version: 1 as const,
    name,
    pid,
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
    artifacts: join(tmpdir(), name),
    visible: false,
    status,
    endpoints: {
      ui: "ws://127.0.0.1:1",
      backend: "ws://127.0.0.1:2",
    },
    control: join(tmpdir(), `${name}.sock`),
  }
}

async function withRegistry<T>(root: string, task: () => Promise<T>) {
  const previous = process.env.DRIVE_REGISTRY_DIR
  process.env.DRIVE_REGISTRY_DIR = join(root, "registry")
  try {
    return await task()
  } finally {
    if (previous === undefined) delete process.env.DRIVE_REGISTRY_DIR
    else process.env.DRIVE_REGISTRY_DIR = previous
  }
}
