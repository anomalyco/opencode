import { defineScript } from "opencode-drive"
import { mkdir } from "node:fs/promises"
import path from "node:path"

export default defineScript({
  launch: "manual",
  setup({ config }) {
    config.autoupdate = false
  },
  async run({ artifacts, llm, server, signal }) {
    await configureServicePort(artifacts)
    await server.launch()

    const registration = await serviceRegistration(artifacts)
    const root = path.resolve(import.meta.dir, "../../../..")
    const session = `mini-stage2-${process.pid}`
    const snapshots = path.join(artifacts, "mini-stage2")
    await mkdir(snapshots, { recursive: true })

    llm.queue(
      llm.toolCall({
        index: 0,
        id: "mini-shell",
        name: "shell",
        input: { command: "printf 'drive-mini-tool-output\\n'" },
      }),
      llm.finish("tool-calls"),
    )
    llm.queue(llm.text("drive mini response complete", { delay: 5, chunkSize: 4 }))

    const abort = () => {
      void tmux(["kill-session", "-t", session], true).catch(() => {})
    }
    signal.addEventListener("abort", abort, { once: true })
    try {
      await tmux([
        "new-session",
        "-d",
        "-s",
        session,
        "-x",
        "140",
        "-y",
        "30",
        "--",
        "env",
        `PWD=${path.join(artifacts, "files")}`,
        `OPENCODE_PASSWORD=${registration.password}`,
        `OPENCODE_CONFIG_DIR=${path.join(artifacts, "files/.opencode")}`,
        `OPENCODE_TEST_HOME=${artifacts}`,
        `XDG_CACHE_HOME=${path.join(artifacts, "home/.cache")}`,
        `XDG_CONFIG_HOME=${path.join(artifacts, "home/.config")}`,
        `XDG_DATA_HOME=${path.join(artifacts, "logs")}`,
        `XDG_STATE_HOME=${path.join(artifacts, "home/.local/state")}`,
        "OPENCODE_DISABLE_AUTOUPDATE=1",
        "OPENCODE_DIRECT_TRACE=1",
        process.execPath,
        "--conditions=browser",
        "--preload=@opentui/solid/preload",
        path.join(root, "packages/cli/src/index.ts"),
        "mini",
        "--server",
        registration.url,
        "--model",
        "simulation/gpt-sim-model",
      ])
      await tmux(["set-option", "-t", session, "remain-on-exit", "on"])

      const first = await waitForPane(session, "OpenCode")
      await Bun.write(path.join(snapshots, "01-first-paint.txt"), first)
      if (first.includes("drive mini response complete")) throw new Error("response rendered before prompt submission")

      await waitForPane(session, "Simulated Model", 15_000)
      await tmux(["send-keys", "-t", session, "-l", "exercise the mini frontend"])
      await Bun.sleep(100)
      await tmux(["send-keys", "-H", "-t", session, "0d"])
      const completed = await waitForPane(session, "drive mini response complete", 20_000)
      if (!completed.includes("drive-mini-tool-output")) throw new Error("shell tool output was not rendered")
      await Bun.write(path.join(snapshots, "02-tool-and-response.txt"), completed)

      await Bun.sleep(500)
      const resizeOutput = path.join(snapshots, "03-resize-output.ansi")
      await tmux(["pipe-pane", "-t", session, `cat > ${JSON.stringify(resizeOutput)}`])
      await tmux(["resize-window", "-t", session, "-x", "72", "-y", "22"])
      await waitForFile(
        resizeOutput,
        (value) => value.includes("drive mini response complete") && value.includes("drive-mini-tool-output"),
      )
      await tmux(["pipe-pane", "-t", session])
      const resized = await captureVisiblePane(session)
      if (!resized.includes("drive-mini-tool-output")) throw new Error("resize replay lost shell tool output")
      await Bun.write(path.join(snapshots, "03-resize-replay.txt"), resized)

      llm.queue(
        llm.toolCall({
          index: 0,
          id: "mini-question",
          name: "question",
          input: {
            questions: [
              {
                header: "Drive form",
                question: "Choose the Mini Form answer",
                options: [{ label: "Accepted", description: "Continue the run" }],
                multiple: false,
              },
            ],
          },
        }),
        llm.finish("tool-calls"),
      )
      llm.queue(llm.text("drive mini form complete"))
      await tmux(["send-keys", "-t", session, "-l", "exercise the form"])
      await tmux(["send-keys", "-H", "-t", session, "0d"])
      await waitForPane(session, "Choose the Mini Form answer", 20_000)
      await tmux(["send-keys", "-H", "-t", session, "0d"])
      await waitForPane(session, "drive mini form complete", 20_000)

      llm.queue(
        llm.toolCall({
          index: 0,
          id: "mini-slow-shell",
          name: "shell",
          input: { command: "sleep 10" },
        }),
        llm.finish("tool-calls"),
      )
      await tmux(["send-keys", "-t", session, "-l", "interrupt this turn"])
      await Bun.sleep(100)
      await tmux(["send-keys", "-H", "-t", session, "0d"])
      await waitForPane(session, "$ sleep 10")
      await tmux(["send-keys", "-t", session, "Escape"])
      const armed = await waitForPane(session, "again to interrupt")
      await Bun.write(path.join(snapshots, "04-interrupt-armed.txt"), armed)
      await tmux(["send-keys", "-t", session, "Escape"])
      const interrupted = await waitForPane(session, "Step interrupted", 10_000)
      await Bun.write(path.join(snapshots, "05-interrupted.txt"), interrupted)
      if (!(await paneAlive(session))) throw new Error("Mini exited while interrupting an active turn")

      await tmux(["send-keys", "-t", session, "C-c"])
      await waitForPane(session, "Press ctrl+c again to exit")
      await tmux(["send-keys", "-t", session, "C-c"])
      await waitForDeadPane(session)
      const status = await paneDeadStatus(session)
      if (status !== 0) throw new Error(`Mini exited with status ${status}`)
      const exited = await capturePane(session)
      if (!exited.includes("Continue") || !exited.includes("opencode mini -s"))
        throw new Error("Mini exit splash was not rendered before teardown")
      await Bun.write(path.join(snapshots, "06-exit-teardown.txt"), exited)
    } finally {
      signal.removeEventListener("abort", abort)
      await tmux(["kill-session", "-t", session], true)
    }
  },
})

/** @param {string[]} args */
async function tmux(args, allowFailure = false) {
  const child = Bun.spawn(["tmux", ...args], { stdout: "pipe", stderr: "pipe" })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill("SIGKILL")
  }, 5_000)
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  clearTimeout(timeout)
  if (timedOut) throw new Error(`tmux ${args[0]} timed out`)
  if (status !== 0 && !allowFailure) throw new Error(`tmux ${args[0]} failed: ${stderr || stdout}`)
  return stdout
}

/** @param {string} session */
function capturePane(session) {
  return tmux(["capture-pane", "-p", "-t", session, "-S", "-"])
}

/** @param {string} session */
function captureVisiblePane(session) {
  return tmux(["capture-pane", "-p", "-t", session])
}

/** @param {string} session */
async function paneAlive(session) {
  return (await tmux(["display-message", "-p", "-t", session, "#{pane_dead}"], true)).trim() === "0"
}

/** @param {string} session */
async function paneDeadStatus(session) {
  return Number((await tmux(["display-message", "-p", "-t", session, "#{pane_dead_status}"])).trim())
}

/**
 * @param {string} session
 * @param {string} text
 * @param {number} [timeout]
 * @param {(() => Promise<void>) | undefined} [trigger]
 */
async function waitForPane(session, text, timeout = 5_000, trigger) {
  const deadline = Date.now() + timeout
  let last = ""
  while (Date.now() < deadline) {
    await trigger?.()
    last = await capturePane(session)
    if (last.includes(text)) return last
    if (!(await paneAlive(session))) throw new Error(`Mini exited before rendering ${JSON.stringify(text)}:\n${last}`)
    await Bun.sleep(50)
  }
  throw new Error(`Timed out waiting for ${JSON.stringify(text)}:\n${last}`)
}

/** @param {string} session */
async function waitForDeadPane(session) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!(await paneAlive(session))) return
    await Bun.sleep(50)
  }
  throw new Error("Mini did not tear down after the exit sequence")
}

/**
 * @param {string} file
 * @param {(value: string) => boolean} accept
 */
async function waitForFile(file, accept) {
  let value = ""
  for (let attempt = 0; attempt < 100; attempt++) {
    value = await Bun.file(file)
      .text()
      .catch(() => "")
    if (accept(value)) return value
    await Bun.sleep(50)
  }
  throw new Error("resize did not replay committed transcript output")
}

/** @param {string} artifacts */
async function configureServicePort(artifacts) {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = probe.port
  await probe.stop(true)
  if (!port) throw new Error("Failed to allocate a Drive service port")
  const file = path.join(artifacts, "files/.opencode/service-local.json")
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, JSON.stringify({ port }))
}

/** @param {string} artifacts */
async function serviceRegistration(artifacts) {
  const directory = path.join(artifacts, "home/.local/state/opencode")
  for (let attempt = 0; attempt < 200; attempt++) {
    for (const name of ["service-local.json", "service.json"]) {
      const value = await Bun.file(path.join(directory, name))
        .json()
        .catch(() => undefined)
      if (isRegistration(value)) return value
    }
    await Bun.sleep(50)
  }
  throw new Error("Drive service registration was not written")
}

/** @param {unknown} value */
function isRegistration(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "url" in value &&
    typeof value.url === "string" &&
    "password" in value &&
    typeof value.password === "string"
  )
}
