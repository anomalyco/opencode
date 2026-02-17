import { Flag } from "@/flag/flag"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { defer } from "@/util/defer"
import fs from "fs/promises"
import path from "path"

const IMAGE = "kalilinux/kali-rolling"
const HEALTH = "/global/health"
const TIMEOUT = 30000

type Result = {
  code: number
  out: string
  err: string
}

type Gate = {
  platform: string
  arch: string
  disable: boolean
  force: boolean
  local: boolean
}

type Run = {
  name: string
  image: string
  cwd: string
  publish: string
  mounts: string[]
  env: string[]
  binary: string
  serve: string[]
}

type Network = {
  hostname: string
  port: number
  mdns: boolean
  mdnsDomain: string
  cors: string[]
}

export namespace AppleContainer {
  export type Runtime = {
    url: string
    directory: string
    headers?: RequestInit["headers"]
    stop: () => Promise<void>
  }

  export function enabled(input?: Partial<Gate>) {
    const value: Gate = {
      platform: input?.platform ?? process.platform,
      arch: input?.arch ?? process.arch,
      disable: input?.disable ?? Flag.OPENCODE_DISABLE_APPLE_CONTAINER,
      force: input?.force ?? Flag.OPENCODE_FORCE_APPLE_CONTAINER,
      local: input?.local ?? Installation.isLocal(),
    }
    if (value.disable) return false
    if (value.force) return true
    if (value.local) return false
    if (value.platform !== "darwin") return false
    return value.arch === "arm64"
  }

  export function publish(input: { host: string; hostPort: number; containerPort: number }) {
    if (input.host === "0.0.0.0") return `${input.hostPort}:${input.containerPort}`
    return `${input.host}:${input.hostPort}:${input.containerPort}`
  }

  export function serve(input: { port: number; mdns: boolean; mdnsDomain: string; cors: string[] }) {
    const cmd = ["serve", "--hostname", "0.0.0.0", "--port", String(input.port)]
    if (input.mdns) cmd.push("--mdns", "--mdns-domain", input.mdnsDomain)
    input.cors.forEach((item) => cmd.push("--cors", item))
    return cmd
  }

  export function run(input: Run) {
    const cmd = [
      "container",
      "run",
      "--detach",
      "--rm",
      "--platform",
      "linux/arm64",
      "--name",
      input.name,
      "-w",
      input.cwd,
      "-p",
      input.publish,
    ]
    input.mounts.forEach((item) => cmd.push("-v", `${item}:${item}`))
    input.env.forEach((item) => cmd.push("-e", item))
    cmd.push(input.image, input.binary, ...input.serve)
    return cmd
  }

  export async function start(input: { directory: string; network: Network }): Promise<Runtime> {
    if (!enabled()) {
      throw new Error("Apple container runtime is disabled. Set OPENCODE_DISABLE_APPLE_CONTAINER=0 to enable it.")
    }

    if (!Bun.which("container")) {
      throw new Error(
        "Apple container runtime is not installed. Re-run the installer or install it from https://github.com/apple/container/releases/latest. Set OPENCODE_DISABLE_APPLE_CONTAINER=1 to bypass container mode.",
      )
    }

    const image = Flag.OPENCODE_APPLE_CONTAINER_IMAGE || IMAGE
    const binary = await linux()
    const host = loopback(input.network.hostname || "127.0.0.1")
    const inputPort = typeof input.network.port === "number" ? input.network.port : 0
    const port = inputPort === 0 ? await random() : inputPort
    const mdns = input.network.mdns === true
    const mdnsDomain = input.network.mdnsDomain || "opencode.local"
    const cors = Array.isArray(input.network.cors) ? input.network.cors : input.network.cors ? [input.network.cors] : []
    const launch = serve({
      port,
      mdns,
      mdnsDomain,
      cors,
    })
    const url = `http://${display(host)}:${port}`
    const vars = env()
    const dirs = mounts({
      directory: input.directory,
      binary,
    })
    const pub = publish({
      host,
      hostPort: port,
      containerPort: port,
    })

    await bootstrap(image)

    const name = `opencode-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const cmd = run({
      name,
      image,
      cwd: input.directory,
      publish: pub,
      mounts: dirs,
      env: vars,
      binary,
      serve: launch,
    })
    const created = await exec(cmd)
    if (created.code !== 0) {
      throw new Error(
        [
          "Failed to start OpenCode inside Apple container.",
          detail(created),
          "Set OPENCODE_DISABLE_APPLE_CONTAINER=1 to use the local server.",
        ].join("\n"),
      )
    }

    const id = created.out || name
    const headers = auth()
    let done = false
    const stop = async () => {
      if (done) return
      done = true
      await exec(["container", "stop", "--time", "5", id])
      await exec(["container", "delete", "--force", id])
    }

    const healthy = await wait({ url, headers, id })
    if (healthy) {
      return {
        url,
        directory: input.directory,
        headers,
        stop,
      }
    }

    await stop()
    const logs = await exec(["container", "logs", "-n", "50", id])
    throw new Error(
      [
        `OpenCode server did not become healthy at ${url}${HEALTH}.`,
        logs.code === 0 ? `Container logs:\n${detail(logs)}` : "Failed to read container logs.",
        "Set OPENCODE_DISABLE_APPLE_CONTAINER=1 to use the local server.",
      ].join("\n"),
    )
  }

  export function mounts(input: { directory: string; binary: string }) {
    return [
      path.resolve(input.directory),
      path.resolve(Global.Path.home),
      path.resolve(Global.Path.config),
      path.resolve(Global.Path.state),
      path.resolve(Global.Path.data),
      path.resolve(Global.Path.cache),
      path.resolve(path.dirname(input.binary)),
    ].filter((item, index, list) => list.indexOf(item) === index)
  }
}

async function bootstrap(image: string) {
  const status = await exec(["container", "system", "status"])
  if (status.code !== 0) {
    const start = await exec(["container", "system", "start", "--enable-kernel-install"])
    if (start.code !== 0) {
      const retry = await exec(["container", "system", "start"])
      if (retry.code !== 0) {
        throw new Error(
          [
            "Failed to start Apple container runtime.",
            detail(start),
            detail(retry),
            "Run `container system start --enable-kernel-install` and retry.",
          ].join("\n"),
        )
      }
    }

    const next = await exec(["container", "system", "status"])
    if (next.code !== 0) {
      throw new Error(
        [
          "Apple container runtime did not become healthy.",
          detail(next),
          "Run `container system status` and retry.",
        ].join("\n"),
      )
    }
  }

  const inspect = await exec(["container", "image", "inspect", image])
  if (inspect.code === 0) return

  const pull = await exec(["container", "image", "pull", "--platform", "linux/arm64", image])
  if (pull.code === 0) return

  throw new Error(
    [
      `Failed to pull required image ${image}.`,
      detail(pull),
      "Run `container image pull --platform linux/arm64 kalilinux/kali-rolling` and retry.",
    ].join("\n"),
  )
}

async function random() {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(null, {
        status: 204,
      })
    },
  })
  const port = server.port
  await server.stop(true)
  if (!port) {
    throw new Error("Failed to allocate a local port for Apple container runtime.")
  }
  return port
}

async function linux() {
  const override = Flag.OPENCODE_APPLE_CONTAINER_BINARY
  if (override) return override

  if (Installation.isLocal()) {
    throw new Error(
      [
        "Apple container mode requires a release build to fetch a Linux OpenCode binary.",
        "Set OPENCODE_APPLE_CONTAINER_BINARY to a Linux opencode binary path or set OPENCODE_DISABLE_APPLE_CONTAINER=1.",
      ].join("\n"),
    )
  }

  const version = Installation.VERSION
  const target = path.join(Global.Path.bin, `opencode-linux-arm64-v${version}`)
  if (await Bun.file(target).exists()) return target

  if (!Bun.which("tar")) {
    throw new Error("`tar` is required to extract the Linux OpenCode binary.")
  }

  const dir = await fs.mkdtemp(path.join(Global.Path.cache, "apple-container-"))
  await using cleanup = defer(async () => fs.rm(dir, { recursive: true, force: true }))
  const archive = path.join(dir, "opencode-linux-arm64.tar.gz")
  const url = `https://github.com/anomalyco/opencode/releases/download/v${version}/opencode-linux-arm64.tar.gz`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      [`Failed to download Linux OpenCode binary for v${version}.`, `URL: ${url}`, `Status: ${response.status}`].join(
        "\n",
      ),
    )
  }

  await Bun.write(archive, response)

  const extracted = await exec(["tar", "-xzf", archive, "-C", dir])
  if (extracted.code !== 0) {
    throw new Error(["Failed to extract Linux OpenCode binary.", detail(extracted)].join("\n"))
  }

  const source = path.join(dir, "opencode")
  if (!(await Bun.file(source).exists())) {
    throw new Error(`Extracted archive for v${version} did not contain the opencode binary.`)
  }

  await fs.copyFile(source, target)
  await fs.chmod(target, 0o755)
  return target
}

function env() {
  const vars = Object.entries(process.env).flatMap(([key, value]) => {
    if (!value) return [] as string[]
    if (key.startsWith("OPENCODE_")) return [`${key}=${value}`]
    if (key.endsWith("_API_KEY")) return [`${key}=${value}`]
    if (key.endsWith("_TOKEN")) return [`${key}=${value}`]
    if (key.startsWith("AWS_")) return [`${key}=${value}`]
    if (key.startsWith("AZURE_")) return [`${key}=${value}`]
    if (key.startsWith("GOOGLE_")) return [`${key}=${value}`]
    if (key === "HTTP_PROXY" || key === "HTTPS_PROXY" || key === "NO_PROXY") return [`${key}=${value}`]
    return [] as string[]
  })
  return vars.filter((item, index, list) => list.indexOf(item) === index)
}

function auth() {
  const password = Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return
  const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
  return {
    Authorization: `Basic ${btoa(`${username}:${password}`)}`,
  }
}

function loopback(hostname: string) {
  if (hostname === "localhost") return "127.0.0.1"
  if (hostname === "::1") return "127.0.0.1"
  return hostname
}

function display(hostname: string) {
  if (hostname === "0.0.0.0") return "127.0.0.1"
  return hostname
}

async function wait(input: { url: string; headers?: RequestInit["headers"]; id: string }) {
  const start = Date.now()
  while (Date.now() - start < TIMEOUT) {
    const healthy = await fetch(input.url + HEALTH, { headers: input.headers })
      .then((response) => response.ok)
      .catch(() => false)
    if (healthy) return true

    const info = await exec(["container", "inspect", input.id])
    if (info.code !== 0) return false
    await Bun.sleep(250)
  }
  return false
}

async function exec(cmd: string[]): Promise<Result> {
  const proc = Bun.spawn({
    cmd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, out, err] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return {
    code,
    out: out.trim(),
    err: err.trim(),
  }
}

function detail(result: Result) {
  return [result.out, result.err].filter(Boolean).join("\n").trim() || "(no output)"
}
