import { expect, spyOn, test } from "bun:test"
import childProcess from "node:child_process"
import path from "node:path"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { waitForHighlightedFrame } from "./fixture/frame"
import { json } from "./fixture/tui-client"

test.each(["loaded", "pending"])(
  "Markdown links use the session directory with %s location metadata",
  async (phase) => {
    await using root = await tmpdir()
    const directory = path.join(root.path, "session")
    const location = { directory, project: { id: "proj_links", directory, canonical: directory } }
    const requested = Promise.withResolvers<void>()
    const metadata = Promise.withResolvers<void>()
    if (phase === "loaded") metadata.resolve()
    const session = {
      id: "ses_links",
      title: "Markdown links",
      projectID: "proj_links",
      location: { directory },
      agent: "build",
      model: { providerID: "fixture", id: "model" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
    }
    const label = "Скачать обновлённую картинку"
    const https = "https://example.com/roadmap"
    await using setup = await createAppFixture({
      width: 100,
      height: 30,
      args: { sessionID: session.id },
      config: { animations: false, tabs: { mode: "off" }, session: { sidebar: "hide" } },
      fetch: (url) => {
        if (url.pathname === "/api/location" && url.searchParams.get("location[directory]") === directory) {
          requested.resolve()
          return metadata.promise.then(() => json(location))
        }
        if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
        if (url.pathname === `/api/session/${session.id}/message`)
          return json({
            data: [
              {
                id: "msg_links",
                type: "assistant",
                agent: session.agent,
                model: session.model,
                time: { created: 2 },
                content: [{ type: "text", text: `[${label}](artifacts/lms-roadmap.png)\n\n[HTTPS control](${https})` }],
              },
            ],
            cursor: {},
          })
        if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
        return undefined
      },
    })
    try {
      await setup.ready
      await requested.promise
      const frame = await waitForHighlightedFrame(
        setup,
        (frame) => frame.includes(label) && frame.includes("HTTPS control"),
      )
      expect(directory).not.toBe(process.cwd())
      const launches: { command: string; args: readonly string[] }[] = []
      // Intercept only the final OS launch; never forward an unexpected spawn to the real system.
      using launcher = spyOn(childProcess, "spawn").mockImplementation(((command: string, args?: readonly string[]) => {
        if (!Array.isArray(args)) throw new Error(`Unexpected launch: ${command}`)
        launches.push({ command, args })
        const child = new childProcess.ChildProcess()
        queueMicrotask(() => {
          child.emit("spawn")
          child.emit("close", 0)
        })
        return child
      }) as typeof childProcess.spawn)
      const rows = frame.split("\n")
      const pngRow = rows.findIndex((row) => row.includes(label))
      await setup.mockMouse.click(rows[pngRow]!.indexOf(label), pngRow)
      await setup.waitFor(() => launches.length > 0 || setup.captureCharFrame().includes("Only http"))
      expect(launches).toHaveLength(1)
      expectLaunch(launches[0]!, path.join(directory, "artifacts", "lms-roadmap.png"))
      const httpsRow = rows.findIndex((row) => row.includes("HTTPS control"))
      await setup.mockMouse.click(rows[httpsRow]!.indexOf("HTTPS control"), httpsRow)
      await setup.waitFor(() => launches.length === 2)
      expectLaunch(launches[1]!, https)
      await setup.renderOnce()
      expect(launcher).toHaveBeenCalledTimes(2)
      expect(setup.captureCharFrame()).not.toContain("Only http")
    } finally {
      metadata.resolve()
    }
  },
)

function expectLaunch(launch: { command: string; args: readonly string[] }, target: string) {
  if (process.platform === "win32") {
    expect(path.basename(launch.command).toLowerCase()).toBe("powershell.exe")
    expect(launch.args.slice(0, -1)).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
    ])
    expect(Buffer.from(launch.args.at(-1)!, "base64").toString("utf16le")).toBe(
      `$ProgressPreference = 'SilentlyContinue'; Start '${target.replaceAll("'", "''")}'`,
    )
    return
  }
  expect(path.basename(launch.command)).toBe(process.platform === "darwin" ? "open" : "xdg-open")
  expect(launch.args).toEqual([target])
}
