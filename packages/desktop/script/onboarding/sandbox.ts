// Keeps a recorded first launch away from everything the developer has: their profile, their OpenCode service,
// their credentials and their opencode:// link handler. Everything the app writes lands under one directory.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type AddressInfo } from "node:net"
import { join } from "node:path"
import { Option, Schema } from "effect"

// System variables a GUI app needs to start. Everything else stays out: provider keys, OPENCODE_*, OTEL_*, and the
// developer's home, temp and XDG directories.
const passthrough =
  /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|COMMONPROGRAMFILES|COMMONPROGRAMFILES\(X86\)|COMMONPROGRAMW6432|NUMBER_OF_PROCESSORS|PROCESSOR_[A-Z_]+|OS|USERNAME|USERDOMAIN|COMPUTERNAME|LANG|LC_[A-Z_]+|SHELL|USER|LOGNAME|DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|XDG_RUNTIME_DIR|XDG_SESSION_TYPE|XDG_CURRENT_DESKTOP|DBUS_SESSION_BUS_ADDRESS|__CF_USER_TEXT_ENCODING)$/i

export async function createSandbox(root: string) {
  rmSync(root, { recursive: true, force: true })
  const home = join(root, "home")

  const dirs = {
    home,
    appData: join(home, "AppData", "Roaming"),
    localAppData: join(home, "AppData", "Local"),
    temp: join(home, "AppData", "Local", "Temp"),
    data: join(home, ".local", "share"),
    state: join(home, ".local", "state"),
    config: join(home, ".config"),
    cache: join(home, ".cache"),
  }

  Object.values(dirs).forEach((dir) => mkdirSync(dir, { recursive: true }))

  // Builds from before the onboarding test mode chose a private service port read it from here. Without one, the
  // recorded app's service would try the channel's port, which the developer's own service already holds.
  const config = join(dirs.config, "opencode")
  mkdirSync(config, { recursive: true })
  writeFileSync(join(config, "service.json"), JSON.stringify({ port: await freePort() }))

  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => passthrough.test(entry[0]) && !!entry[1],
      ),
    ),
    HOME: home,
    USERPROFILE: home,
    APPDATA: dirs.appData,
    LOCALAPPDATA: dirs.localAppData,
    TEMP: dirs.temp,
    TMP: dirs.temp,
    TMPDIR: dirs.temp,
    XDG_DATA_HOME: dirs.data,
    XDG_STATE_HOME: dirs.state,
    XDG_CONFIG_HOME: dirs.config,
    XDG_CACHE_HOME: dirs.cache,
    OPENCODE_CONFIG_DIR: config,
    OPENCODE_DB: join(dirs.data, "opencode", "opencode.db"),
    OPENCODE_TEST_HOME: home,
    // A fresh profile per launch, its Documents folder included, with no update checks and no opencode:// handler.
    OPENCODE_TEST_ONBOARDING: "1",
  }

  return { root, home, env }
}

export function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      // SAFETY: a TCP server listening on a host and port reports its AddressInfo, not a pipe name.
      const port = (server.address() as AddressInfo).port
      server.close(() => resolve(port))
    })
  })
}

/** Stops every OpenCode service that registered itself inside the sandbox. */
export function stopSandboxServices(root: string) {
  return files(root)
    .filter((file) => /[\\/]opencode[\\/]service[^\\/]*\.json$/.test(file))
    .flatMap((file) => {
      const pid = registeredPid(file)

      if (!pid) return []
      killTree(pid)

      return [pid]
    })
}

export function killTree(pid: number) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" })

    return
  }

  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGKILL")
    } catch {}
  }
}

/** Finds the app's own log files, wherever its profile ended up inside the sandbox. */
export function sandboxLogs(root: string) {
  return files(root).filter((file) => /[\\/]logs[\\/].+\.log$/.test(file))
}

// Packaged builds from before the onboarding test mode take over opencode:// when they start. Remember who owned it
// and give it back afterwards.
export function protocolGuard(scratch: string) {
  if (process.platform === "win32") {
    const key = "HKCU\\Software\\Classes\\opencode"
    const backup = join(scratch, "opencode-protocol.reg")
    const query = () => spawnSync("reg", ["query", key, "/s"], { encoding: "utf8" }).stdout ?? ""
    const before = query()
    const existed = spawnSync("reg", ["export", key, backup, "/y"], { stdio: "ignore" }).status === 0

    return () => {
      if (query() === before) return "unchanged"
      spawnSync("reg", ["delete", key, "/f"], { stdio: "ignore" })

      if (existed) spawnSync("reg", ["import", backup], { stdio: "ignore" })

      return query() === before ? "restored" : "changed"
    }
  }

  if (process.platform === "darwin") {
    const handler = (set?: string) =>
      spawnSync(
        "osascript",
        [
          "-l",
          "JavaScript",
          "-e",
          set
            ? `ObjC.import("CoreServices"); $.LSSetDefaultHandlerForURLScheme($("opencode"), $(${JSON.stringify(set)}))`
            : `ObjC.import("CoreServices"); ObjC.unwrap($.LSCopyDefaultHandlerForURLScheme($("opencode"))) ?? ""`,
        ],
        { encoding: "utf8" },
      ).stdout?.trim() ?? ""

    const before = handler()

    return () => {
      if (handler() === before) return "unchanged"

      if (before) handler(before)

      return handler() === before ? "restored" : "changed"
    }
  }

  const handler = (set?: string) =>
    spawnSync(
      "xdg-settings",
      set ? ["set", "default-url-scheme-handler", "opencode", set] : ["get", "default-url-scheme-handler", "opencode"],
      {
        encoding: "utf8",
      },
    ).stdout?.trim() ?? ""

  const before = handler()

  return () => {
    if (handler() === before) return "unchanged"

    if (before) handler(before)

    return handler() === before ? "restored" : "changed"
  }
}

/** Starts a process and resolves each stderr/stdout line through `onLine`. */
export function launch(command: string, args: string[], env: Record<string, string>, onLine: (line: string) => void) {
  const child = spawn(command, args, {
    env,
    cwd: env.HOME,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  })

  const read = (stream: NodeJS.ReadableStream | null) => {
    let buffer = ""
    stream?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ""
      lines.forEach(onLine)
    })
  }

  read(child.stdout)
  read(child.stderr)

  return child
}

const Registration = Schema.fromJsonString(Schema.Struct({ pid: Schema.Number }))

function registeredPid(file: string) {
  if (!existsSync(file)) return undefined

  return Option.getOrUndefined(Schema.decodeUnknownOption(Registration)(readFileSync(file, "utf8")))?.pid
}

function files(root: string): string[] {
  if (!existsSync(root)) return []

  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
}
