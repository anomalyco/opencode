const main = async () => {
  const args = process.argv.slice(2)
  const debug = args.includes("--debug")

  const log = (...parts: string[]) => console.log(...parts)

  const logs = debug ? ["--print-logs", "--log-level", "DEBUG"] : []
  const vlogs = debug ? ["--debug"] : []

  const wait = async (url: string) => {
    for (const _ of Array.from({ length: 80 })) {
      const ok = await fetch(url)
        .then((res) => res.ok)
        .catch(() => false)
      if (ok) return
      await Bun.sleep(125)
    }
    throw new Error(`Timed out waiting for ${url}`)
  }

  log("")
  log("Starting local OpenCode web dev...")
  if (debug) log("Debug mode enabled")
  log("")

  const server = await (async () => {
    const proc = Bun.spawn({
      cmd: ["bun", "run", "--cwd", "packages/opencode", "dev", "--", ...logs, "serve"],
      env: { ...process.env, OPENCODE_CLIENT: "web" },
      stdin: "inherit",
      stdout: "pipe",
      stderr: "inherit",
    })

    const out = proc.stdout
    if (!out) throw new Error("Failed to read opencode stdout")

    const rd = out.getReader()
    const dec = new TextDecoder()
    const buf = { text: "" }
    const seen = { url: "" }

    const found = new Promise<string>((resolve, reject) => {
      const pump = async () => {
        while (true) {
          const chunk = await rd.read()
          if (chunk.done) break

          process.stdout.write(chunk.value)
          buf.text += dec.decode(chunk.value, { stream: true })

          const lines = buf.text.split(/\r?\n/)
          buf.text = lines.pop() ?? ""

          for (const line of lines) {
            if (seen.url) continue
            const m = line.match(/opencode server listening on (https?:\/\/\S+)/)
            if (!m?.[1]) continue
            seen.url = m[1]
            resolve(seen.url)
          }
        }
        if (seen.url) return
        reject(new Error("opencode exited before printing server URL"))
      }
      void pump()

      void proc.exited.then((code) => {
        if (seen.url) return
        reject(new Error(`opencode exited (code ${code}) before printing server URL`))
      })
    })

    const base = new URL(await found)
    await wait(`${base.origin}/global/health`).catch((err) => {
      proc.kill("SIGTERM")
      throw err
    })

    return { base, proc }
  })()

  const app = Bun.spawn({
    cmd: ["bun", "run", "--cwd", "packages/app", "dev", "--", ...vlogs],
    env: {
      ...process.env,
      VITE_OPENCODE_SERVER_HOST: server.base.hostname,
      VITE_OPENCODE_SERVER_PORT: server.base.port || (server.base.protocol === "https:" ? "443" : "80"),
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })

  log("")
  log(`OpenCode server: ${server.base.origin}`)
  log("Press Ctrl+C to stop.")
  log("")

  const procs = [server.proc, app]
  const stop = (signal: "SIGINT" | "SIGTERM") => {
    for (const proc of procs) proc.kill(signal)
  }

  process.on("SIGINT", () => stop("SIGINT"))
  process.on("SIGTERM", () => stop("SIGTERM"))

  const result = await Promise.race(
    procs.map(async (proc, index) => {
      const code = await proc.exited
      return { code, index }
    }),
  )

  stop("SIGTERM")
  process.exit(result.code)
}

await main()
