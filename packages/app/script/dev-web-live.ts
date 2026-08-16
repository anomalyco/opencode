#!/usr/bin/env bun

import { join } from "path"
import { fileURLToPath } from "url"

const root = fileURLToPath(new URL("../../..", import.meta.url))
const localUrl = "http://localhost:4444"

const discovery = Bun.spawnSync(["opencode2", "service", "status"], {
  cwd: root,
  stdout: "pipe",
  stderr: "pipe",
})
if (discovery.exitCode !== 0)
  throw new Error("The installed opencode2 service is unavailable. Start it separately and retry.")

const discovered = discovery.stdout.toString().trim()
if (!URL.canParse(discovered)) throw new Error("opencode2 service status did not return a valid HTTP URL.")

const server = new URL(discovered)
if (
  server.protocol !== "http:" ||
  !server.hostname ||
  server.username ||
  server.password ||
  server.pathname !== "/" ||
  server.search ||
  server.hash
) {
  throw new Error("opencode2 service status did not return a valid HTTP origin URL.")
}

try {
  await Bun.serve({ hostname: "127.0.0.1", port: 4444, fetch: () => new Response() }).stop(true)
} catch {
  throw new Error("Port 4444 is already in use. Stop the process using it and retry.")
}

const vite = Bun.spawn([process.execPath, "dev", "--", "--host", "127.0.0.1", "--port", "4444", "--strictPort"], {
  cwd: join(root, "packages/app"),
  env: {
    ...process.env,
    VITE_OPENCODE_SERVER_HOST: server.hostname,
    VITE_OPENCODE_SERVER_PORT: server.port || "80",
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

const stop = () => vite.kill()
process.on("SIGINT", stop)
process.on("SIGTERM", stop)

try {
  await waitForVite(vite)
  if ((await openBrowser(readPassword())) !== 0) {
    throw new Error("Could not open the local web app in a browser.")
  }
  process.exitCode = await vite.exited
} finally {
  process.off("SIGINT", stop)
  process.off("SIGTERM", stop)
  if (vite.exitCode === null) vite.kill()
  await vite.exited
}

async function waitForVite(vite: Bun.Subprocess) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (vite.exitCode !== null) throw new Error("Local Vite failed to start on port 4444.")
    const ready = await fetch(localUrl).then(
      async (response) => {
        await response.body?.cancel()
        return true
      },
      () => false,
    )
    if (ready) return
    await Bun.sleep(100)
  }
  throw new Error("Local Vite failed to start on port 4444.")
}

function openBrowser(password: string) {
  const url = `${localUrl}/?auth_token=${encodeURIComponent(btoa(`opencode:${password}`))}`
  return Bun.spawn(
    process.env.BROWSER
      ? [process.env.BROWSER, url]
      : process.platform === "darwin"
        ? ["open", url]
        : process.platform === "win32"
          ? ["explorer.exe", url]
          : ["xdg-open", url],
    { stdout: "ignore", stderr: "ignore" },
  ).exited
}

function readPassword() {
  const credential = Bun.spawnSync(["opencode2", "service", "get", "password"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (credential.exitCode !== 0) throw new Error("Could not read credentials from the installed opencode2 service.")

  const password = credential.stdout.toString().trim()
  if (!password) throw new Error("The installed opencode2 service returned an empty password.")
  return password
}
