import { spawn } from "node:child_process"
import { access, readdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { Option, Schema } from "effect"
import { deriveCbcKey, readChromiumCookies, type ChromiumKey } from "./chromium"
import type { CookieRead } from "./cookie"
import { firefoxProfiles, readFirefoxCookies } from "./firefox"
import { parseBinaryCookies } from "./safari"

/** How a browser keeps its cookies. */
export type Engine = "chromium" | "firefox" | "safari"

/** A browser installed on this machine and the profiles that have cookies. */
export type Source = {
  readonly id: string
  readonly name: string
  readonly engine: Engine
  /** The installed application, whose file carries the browser's icon; undefined where none was found. */
  readonly application: string | undefined
  readonly profiles: readonly { readonly id: string; readonly name: string }[]
}

/** Why an import read nothing. */
export type ReadFailure =
  /** The browser's key could not be read, e.g. the user denied the Keychain prompt. */
  | "key"
  /** The operating system denied access, e.g. Safari without Full Disk Access. */
  | "access"
  /** The browser holds its cookie database open without sharing, as Chromium does on Windows while it runs. */
  | "locked"
  /** The browser or profile is gone, or its database could not be read. */
  | "read"

/** A read that found no cookies, and why. */
export type SourceFailure = { readonly failure: ReadFailure }

type Definition = {
  readonly id: string
  readonly name: string
  readonly engine: Engine
  readonly root: string
  /** macOS Keychain item of the Safe Storage password. */
  readonly keychain?: { readonly service: string; readonly account: string }
  /** Linux keyring `application` attributes to try for the `v11` password. */
  readonly keyring?: readonly string[]
  /** The user data directory is the profile, as in Opera. */
  readonly flat?: boolean
}

/** Every browser this desktop can import from, with its data directory on this system. */
function definitions(): Definition[] {
  const home = homedir()

  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local")
    const roaming = process.env.APPDATA ?? path.join(home, "AppData", "Roaming")

    return [
      chromium("chrome", "Google Chrome", path.join(local, "Google", "Chrome", "User Data")),
      chromium("edge", "Microsoft Edge", path.join(local, "Microsoft", "Edge", "User Data")),
      chromium("helium", "Helium", path.join(local, "imput", "Helium", "User Data")),
      chromium("brave", "Brave", path.join(local, "BraveSoftware", "Brave-Browser", "User Data")),
      chromium(
        "arc",
        "Arc",
        path.join(local, "Packages", "TheBrowserCompany.Arc_ttt1ap7aakyb4", "LocalCache", "Local", "Arc", "User Data"),
      ),
      chromium("vivaldi", "Vivaldi", path.join(local, "Vivaldi", "User Data")),
      { ...chromium("opera", "Opera", path.join(roaming, "Opera Software", "Opera Stable")), flat: true },
      chromium("chromium", "Chromium", path.join(local, "Chromium", "User Data")),
      firefox("firefox", "Firefox", path.join(roaming, "Mozilla", "Firefox")),
      firefox("zen", "Zen", path.join(roaming, "zen")),
      firefox("librewolf", "LibreWolf", path.join(roaming, "librewolf")),
      firefox("floorp", "Floorp", path.join(roaming, "Floorp")),
    ]
  }

  if (process.platform === "darwin") {
    const support = path.join(home, "Library", "Application Support")
    const keychain = (account: string, service = `${account} Safe Storage`) => ({ keychain: { service, account } })

    return [
      { ...chromium("chrome", "Google Chrome", path.join(support, "Google", "Chrome")), ...keychain("Chrome") },
      { ...chromium("edge", "Microsoft Edge", path.join(support, "Microsoft Edge")), ...keychain("Microsoft Edge") },
      {
        ...chromium("helium", "Helium", path.join(support, "net.imput.helium")),
        ...keychain("Helium", "Helium Storage Key"),
      },
      { ...chromium("arc", "Arc", path.join(support, "Arc", "User Data")), ...keychain("Arc") },
      { ...chromium("brave", "Brave", path.join(support, "BraveSoftware", "Brave-Browser")), ...keychain("Brave") },
      { ...chromium("dia", "Dia", path.join(support, "Dia", "User Data")), ...keychain("Dia") },
      { ...chromium("comet", "Comet", path.join(support, "Comet")), ...keychain("Comet") },
      { ...chromium("vivaldi", "Vivaldi", path.join(support, "Vivaldi")), ...keychain("Vivaldi") },
      {
        ...chromium("opera", "Opera", path.join(support, "com.operasoftware.Opera")),
        ...keychain("Opera"),
        flat: true,
      },
      { ...chromium("chromium", "Chromium", path.join(support, "Chromium")), ...keychain("Chromium") },
      { id: "safari", name: "Safari", engine: "safari", root: path.join(home, "Library") },
      firefox("firefox", "Firefox", path.join(support, "Firefox")),
      firefox("zen", "Zen", path.join(support, "zen")),
      firefox("librewolf", "LibreWolf", path.join(support, "librewolf")),
      firefox("floorp", "Floorp", path.join(support, "Floorp")),
    ]
  }

  const config = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config")
  const keyring = (...names: string[]) => ({ keyring: names })

  return [
    { ...chromium("chrome", "Google Chrome", path.join(config, "google-chrome")), ...keyring("chrome") },
    { ...chromium("edge", "Microsoft Edge", path.join(config, "microsoft-edge")), ...keyring("chromium") },
    { ...chromium("helium", "Helium", path.join(config, "net.imput.helium")), ...keyring("helium", "chromium") },
    { ...chromium("brave", "Brave", path.join(config, "BraveSoftware", "Brave-Browser")), ...keyring("brave") },
    { ...chromium("vivaldi", "Vivaldi", path.join(config, "vivaldi")), ...keyring("vivaldi", "chrome") },
    { ...chromium("opera", "Opera", path.join(config, "opera")), ...keyring("chromium"), flat: true },
    { ...chromium("chromium", "Chromium", path.join(config, "chromium")), ...keyring("chromium") },
    firefox("firefox", "Firefox", path.join(home, ".mozilla", "firefox")),
    firefox("firefox-snap", "Firefox (Snap)", path.join(home, "snap", "firefox", "common", ".mozilla", "firefox")),
    firefox("zen", "Zen", path.join(home, ".zen")),
    firefox("librewolf", "LibreWolf", path.join(home, ".librewolf")),
    firefox("floorp", "Floorp", path.join(home, ".floorp")),
  ]
}

function chromium(id: string, name: string, root: string): Definition {
  return { id, name, engine: "chromium", root }
}

function firefox(id: string, name: string, root: string): Definition {
  return { id, name, engine: "firefox", root }
}

/**
 * The browsers installed here that have at least one profile with cookies, the one used last first: its cookies changed
 * most recently, so it is the browser the user is signed in with.
 */
export async function listSources(): Promise<Source[]> {
  const found = await Promise.all(
    definitions().map(async (definition) => {
      const listed = (await profiles(definition)).toSorted((a, b) => b.used - a.used)

      return {
        id: definition.id,
        name: definition.name,
        engine: definition.engine,
        application: await first(applications(definition.id)),
        used: listed[0]?.used ?? 0,
        profiles: listed.map((profile) => ({ id: profile.id, name: profile.name })),
      }
    }),
  )

  return found.filter((source) => source.profiles.length > 0).toSorted((a, b) => b.used - a.used)
}

/**
 * Where a browser's application may be installed, for its icon: the executable on Windows, the bundle on macOS. Linux
 * has no single file that carries the icon.
 */
function applications(id: string) {
  const home = homedir()

  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local")
    const programs = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], local].flatMap((root) => root ?? [])
    const installed = (...parts: string[]) => programs.map((root) => path.join(root, ...parts))

    const known = new Map([
      ["chrome", installed("Google", "Chrome", "Application", "chrome.exe")],
      ["edge", installed("Microsoft", "Edge", "Application", "msedge.exe")],
      ["helium", installed("imput", "Helium", "Application", "chrome.exe")],
      ["brave", installed("BraveSoftware", "Brave-Browser", "Application", "brave.exe")],
      ["vivaldi", installed("Vivaldi", "Application", "vivaldi.exe")],
      ["opera", installed("Programs", "Opera", "opera.exe")],
      ["chromium", installed("Chromium", "Application", "chrome.exe")],
      ["firefox", installed("Mozilla Firefox", "firefox.exe")],
      ["zen", installed("Zen Browser", "zen.exe")],
      ["librewolf", installed("LibreWolf", "librewolf.exe")],
      ["floorp", installed("Ablaze Floorp", "floorp.exe")],
    ])

    return known.get(id) ?? []
  }

  if (process.platform !== "darwin") return []

  // Bundle names in /Applications; Zen shipped under both.
  const bundles = new Map([
    ["chrome", ["Google Chrome"]],
    ["edge", ["Microsoft Edge"]],
    ["helium", ["Helium"]],
    ["arc", ["Arc"]],
    ["brave", ["Brave Browser"]],
    ["dia", ["Dia"]],
    ["comet", ["Comet"]],
    ["vivaldi", ["Vivaldi"]],
    ["opera", ["Opera"]],
    ["chromium", ["Chromium"]],
    ["safari", ["Safari"]],
    ["firefox", ["Firefox"]],
    ["zen", ["Zen", "Zen Browser"]],
    ["librewolf", ["LibreWolf"]],
    ["floorp", ["Floorp"]],
  ])

  return (bundles.get(id) ?? []).flatMap((name) => [
    path.join("/Applications", `${name}.app`),
    path.join(home, "Applications", `${name}.app`),
  ])
}

/** Reads a profile's cookies. `profile` must be an id `listSources` returned, so no path from a window is opened. */
export async function readSource(id: string, profile: string): Promise<CookieRead | SourceFailure> {
  const definition = definitions().find((item) => item.id === id)
  const target = definition ? (await profiles(definition)).find((item) => item.id === profile) : undefined

  if (!definition || !target) return { failure: "read" }

  if (definition.engine === "firefox") return readFirefoxCookies(target.directory).catch(readFailure)

  if (definition.engine === "safari") return readFile(target.directory).then(parseBinaryCookies, readFailure)
  const key = await chromiumKey(definition).catch(() => undefined)

  if (!key) return { failure: "key" }

  return readChromiumCookies(target.database, key).catch(readFailure)
}

/** A Chromium profile's directory, for importing its extensions. */
export async function chromiumProfileDirectory(id: string, profile: string) {
  const definition = definitions().find((item) => item.id === id && item.engine === "chromium")
  const target = definition ? (await profiles(definition)).find((item) => item.id === profile) : undefined

  return target?.directory
}

/**
 * Why reading another browser's files failed. Chromium on Windows opens its cookie database without sharing while it runs,
 * so nothing can copy it until the browser quits.
 */
function readFailure(error: NodeJS.ErrnoException): SourceFailure {
  if (error.code === "EBUSY") return { failure: "locked" }

  if (error.code === "EPERM" || error.code === "EACCES") return { failure: "access" }

  return { failure: "read" }
}

/** `used` is when the profile's cookies last changed, in milliseconds. */
type Profile = { id: string; name: string; directory: string; database: string; used: number }

async function profiles(definition: Definition): Promise<Profile[]> {
  const located = await locate(definition)

  return Promise.all(located.map(async (profile) => ({ ...profile, used: await modified(profile.database) })))
}

/** When a cookie database last changed: the newer of the file and its write-ahead log. */
async function modified(database: string) {
  const times = await Promise.all(
    [database, `${database}-wal`].map((file) =>
      stat(file).then(
        (info) => info.mtimeMs,
        () => 0,
      ),
    ),
  )

  return Math.max(...times)
}

async function locate(definition: Definition): Promise<Omit<Profile, "used">[]> {
  if (definition.engine === "safari") {
    const files = [
      path.join(
        definition.root,
        "Containers",
        "com.apple.Safari",
        "Data",
        "Library",
        "Cookies",
        "Cookies.binarycookies",
      ),
      path.join(definition.root, "Cookies", "Cookies.binarycookies"),
    ]

    const file = await first(files)

    return file ? [{ id: "default", name: "Default", directory: file, database: file }] : []
  }

  if (definition.engine === "firefox") {
    const ini = await readFile(path.join(definition.root, "profiles.ini"), "utf8").catch(() => "")
    const listed = firefoxProfiles(definition.root, ini)

    const found = await Promise.all(
      listed.map(async (profile) => {
        const database = path.join(profile.directory, "cookies.sqlite")

        return (await exists(database)) ? [{ ...profile, database }] : []
      }),
    )

    return found.flat()
  }

  if (definition.flat) {
    const database = await cookieDatabase(definition.root)

    return database ? [{ id: "default", name: "Default", directory: definition.root, database }] : []
  }

  const names = await localStateProfiles(definition.root)

  const found = await Promise.all(
    [...names].map(async ([id, name]) => {
      const directory = path.join(definition.root, id)
      const database = await cookieDatabase(directory)

      return database ? [{ id, name, directory, database }] : []
    }),
  )

  return found.flat()
}

const LocalState = Schema.Struct({
  profile: Schema.optional(
    Schema.Struct({
      info_cache: Schema.optional(
        Schema.Record(Schema.String, Schema.Struct({ name: Schema.optional(Schema.String) })),
      ),
    }),
  ),
  os_crypt: Schema.optional(Schema.Struct({ encrypted_key: Schema.optional(Schema.String) })),
})

const decodeLocalState = Schema.decodeUnknownOption(Schema.fromJsonString(LocalState))

async function localState(root: string) {
  const text = await readFile(path.join(root, "Local State"), "utf8").catch(() => undefined)

  return text === undefined ? undefined : Option.getOrUndefined(decodeLocalState(text))
}

/** Profile directories by id with their display names. `Default` is listed even when `Local State` omits it. */
async function localStateProfiles(root: string) {
  const state = await localState(root)

  const names = new Map(
    Object.entries(state?.profile?.info_cache ?? {})
      // Directory names come from the file, so anything that is not one plain directory name is ignored.
      .filter(([id]) => id === path.basename(id) && id !== ".." && id !== ".")
      .map(([id, info]) => [id, info.name || id]),
  )

  if (!names.has("Default")) names.set("Default", "Default")

  return names
}

async function cookieDatabase(directory: string) {
  return first([path.join(directory, "Network", "Cookies"), path.join(directory, "Cookies")])
}

async function chromiumKey(definition: Definition): Promise<ChromiumKey | undefined> {
  if (process.platform === "win32") {
    const encrypted = (await localState(definition.root))?.os_crypt?.encrypted_key
    const wrapped = encrypted ? Buffer.from(encrypted, "base64") : undefined

    if (!wrapped || wrapped.subarray(0, 5).toString("latin1") !== "DPAPI") return undefined

    return { type: "gcm", key: await unprotect(wrapped.subarray(5)) }
  }

  if (process.platform === "darwin") {
    if (!definition.keychain) return undefined

    const password = await run("security", [
      "find-generic-password",
      "-w",
      "-a",
      definition.keychain.account,
      "-s",
      definition.keychain.service,
    ])

    return { type: "cbc", v10: deriveCbcKey(password.trim(), 1003), v11: undefined }
  }

  // Linux: `v10` values use a fixed password; `v11` the one the desktop keyring holds, if any.
  const passwords = await Promise.all(
    (definition.keyring ?? []).map((application) =>
      run("secret-tool", ["lookup", "application", application]).then(
        (value) => value.trim(),
        () => "",
      ),
    ),
  )

  const keyring = passwords.find((value) => value.length > 0)

  return {
    type: "cbc",
    v10: deriveCbcKey("peanuts", 1),
    v11: keyring ? deriveCbcKey(keyring, 1) : undefined,
  }
}

/** Unwraps a Windows DPAPI blob for the current user through Windows PowerShell, which every Windows install has. */
async function unprotect(blob: Uint8Array) {
  const script =
    "Add-Type -AssemblyName System.Security;" +
    "$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());" +
    "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))"

  const output = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    Buffer.from(blob).toString("base64"),
  )

  return Buffer.from(output.trim(), "base64")
}

const decodeIcons = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)))

/**
 * The icons of Windows executables as PNG data URLs, by path, in one Windows PowerShell run. Electron's own
 * `getFileIcon` answers with the generic program icon for a browser installed under the user's profile, where most
 * Chromium browsers install. A file without an icon, or a failed run, leaves its path out.
 */
export async function windowsIcons(files: readonly string[]) {
  if (files.length === 0) return new Map<string, string>()

  const script =
    "Add-Type -AssemblyName System.Drawing;$o=@{};" +
    'foreach($p in ([Console]::In.ReadToEnd() -split "`n")){$p=$p.Trim();if(-not $p){continue};' +
    "try{$m=New-Object IO.MemoryStream;" +
    "[Drawing.Icon]::ExtractAssociatedIcon($p).ToBitmap().Save($m,[Drawing.Imaging.ImageFormat]::Png);" +
    "$o[$p]=[Convert]::ToBase64String($m.ToArray())}catch{}};" +
    "$o|ConvertTo-Json -Compress"

  const output = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    files.join("\n"),
  ).catch(() => "")

  const icons = Option.getOrUndefined(decodeIcons(output.trim())) ?? {}

  return new Map(Object.entries(icons).map(([file, data]) => [file, `data:image/png;base64,${data}`]))
}

function run(command: string, args: readonly string[], input?: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] })
    const chunks: Buffer[] = []
    const timer = setTimeout(() => child.kill(), 60_000)
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
    child.on("error", reject)
    child.on("close", (code) => {
      clearTimeout(timer)

      if (code === 0) return resolve(Buffer.concat(chunks).toString("utf8"))
      reject(new Error(`${command} exited with ${code}`))
    })
    child.stdin.end(input ?? "")
  })
}

async function exists(file: string) {
  return access(file).then(
    () => true,
    () => false,
  )
}

async function first(files: readonly string[]) {
  const found = await Promise.all(files.map(exists))

  return files[found.indexOf(true)]
}

/** The directories of a Chromium profile's installed extensions: the newest version of each. */
export async function profileExtensions(directory: string) {
  const root = path.join(directory, "Extensions")
  const ids = await readdir(root).catch(() => [])

  const found = await Promise.all(
    ids
      .filter((id) => /^[a-p]{32}$/.test(id))
      .map(async (id) => {
        const versions = await readdir(path.join(root, id)).catch(() => [])
        const latest = versions.toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1)

        return latest ? [{ id, directory: path.join(root, id, latest) }] : []
      }),
  )

  return found.flat()
}
