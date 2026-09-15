import { NodeServices } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { expect, spyOn, test } from "bun:test"
import { Effect, FileSystem, PlatformError, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { Updater } from "../src/services/updater"
import { testEffect } from "../../core/test/lib/effect"

const it = testEffect(NodeServices.layer)

declare const OPENCODE_CLI_NAME: string | undefined

type CommandResult = Partial<AppProcess.RunResult> & { error?: AppProcess.AppProcessError }

function misePaths(input: { name?: string; version?: string; data?: string; binary?: string } = {}) {
  const name = input.name ?? "@opencode/cli"
  const directory = path.join(
    input.data ?? "custom-data",
    "installs",
    `npm-${name.replace(/^@/, "").replaceAll("/", "-")}`,
    input.version ?? "2.0.2",
  )
  return {
    directory,
    executable: path.join(directory, "node_modules", name, "bin", input.binary ?? "opencode"),
  }
}

function fixture(
  respond: (command: ChildProcess.StandardCommand, root: string) => CommandResult | Promise<CommandResult> = () => ({}),
  name = "@opencode/cli",
  failCleanup = false,
  location = "package/bin/opencode",
  releasePackage = name,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "opencode-updater-" }))
    const executable = path.join(root, location)
    yield* fs.makeDirectory(path.dirname(executable), { recursive: true })
    yield* fs.writeFileString(
      path.join(path.dirname(path.dirname(executable)), "package.json"),
      JSON.stringify({ name, bin: { opencode: `bin/${path.basename(executable)}` } }),
    )
    yield* fs.writeFileString(
      path.join(root, "mise config.toml"),
      '[tools]\n"npm:@opencode/cli" = { version = "latest", allow_builds = true, allow_low_downloads = true }\n',
    )
    // The updater uses global fetch; scope this replacement to each install test.
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        spyOn(globalThis, "fetch").mockImplementation(
          Object.assign(async () => Response.json({ version: "2.3.4", metadata: { package: releasePackage } }), {
            preconnect: fetch.preconnect,
          }),
        ),
      ),
      (request) => Effect.sync(() => request.mockRestore()),
    )
    const global = Global.make({
      home: path.join(root, "home"),
      data: path.join(root, "data"),
      cache: path.join(root, "cache"),
      config: path.join(root, "config"),
      state: path.join(root, "state"),
      tmp: path.join(root, "tmp"),
      bin: path.join(root, "bin"),
      log: path.join(root, "log"),
      repos: path.join(root, "repos"),
    })
    const commands: string[][] = []
    const updater = yield* Updater.Service.pipe(
      Effect.provide(Updater.layer),
      Effect.provideService(Global.Service, global),
      Effect.provideService(FileSystem.FileSystem, {
        ...fs,
        remove: (target, options) =>
          failCleanup && target.startsWith(global.cache)
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "PermissionDenied",
                  module: "FileSystem",
                  method: "remove",
                  pathOrDescriptor: target,
                }),
              )
            : fs.remove(target, options),
        realPath: (input) => (input === process.execPath ? Effect.succeed(executable) : fs.realPath(input)),
      }),
      Effect.provideService(
        AppProcess.Service,
        AppProcess.Service.of({
          ...spawner,
          run: (command) =>
            Effect.gen(function* () {
              if (command._tag !== "StandardCommand") return yield* Effect.die("Unexpected piped install command")
              commands.push([command.command, ...command.args])
              const result = yield* Effect.promise(async () => respond(command, root))
              if (result.error) return yield* Effect.fail(result.error)
              return {
                command: command.command,
                exitCode: 0,
                stdout: Buffer.alloc(0),
                stderr: Buffer.alloc(0),
                stdoutTruncated: false,
                stderrTruncated: false,
                ...result,
              }
            }),
          runStream: () => Stream.die("Unexpected streaming install command"),
        }),
      ),
    )
    return { updater, commands, global, fs, root }
  })
}

const installs = [
  { method: "npm", command: ["npm", "install", "--global", "--force", "@opencode/cli@2.3.4-beta.1"] },
  {
    method: "pnpm",
    command: ["pnpm", "add", "--global", "--allow-build=@opencode/cli", "@opencode/cli@2.3.4-beta.1"],
  },
  { method: "yarn", command: ["yarn", "global", "add", "@opencode/cli@2.3.4-beta.1"] },
] as const

installs.forEach(({ method, command }) => {
  it.live(`${method} installs the explicit V2 package version without a leading v`, () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.updater.upgrade(method, "v2.3.4-beta.1")
      expect(test.commands).toEqual([[...command]])
    }),
  )
})
;[0, 1].forEach((exitCode) => {
  it.live(`bun isolates and removes its install cache after exit ${exitCode}`, () =>
    Effect.gen(function* () {
      const test = yield* fixture((command) => {
        expect(command.command).toBe("bun")
        expect(existsSync(command.args[4])).toBe(true)
        return { exitCode, stderr: Buffer.from("bun install failed") }
      })
      const result = yield* test.updater.upgrade("bun", "v2.3.4-beta.1").pipe(Effect.flip, Effect.option)
      const cache = test.commands[0]?.[5]
      expect(cache).toStartWith(path.join(test.global.cache, "update-"))
      expect(test.commands).toEqual([
        ["bun", "install", "--global", "--trust", "--cache-dir", cache, "@opencode/cli@2.3.4-beta.1"],
      ])
      expect(yield* test.fs.readDirectory(test.global.cache)).toEqual([])
      expect(result._tag).toBe(exitCode === 0 ? "None" : "Some")
      if (result._tag === "Some") expect(result.value.message).toBe("bun install failed")
    }),
  )
})

if (Bun.which("mise")) {
  ;["latest", "2", "2.0", "2.0.2"].forEach((requested) => {
    it.live(`real mise preserves tool options when upgrading ${requested} in an isolated config`, () =>
      Effect.gen(function* () {
        const registry = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              fetch: () =>
                Response.json({
                  name: "@opencode/cli",
                  "dist-tags": { latest: "2.3.4" },
                  versions: {
                    "2.0.2": { name: "@opencode/cli", version: "2.0.2", dist: { tarball: "http://127.0.0.1/unused" } },
                    "2.3.4": { name: "@opencode/cli", version: "2.3.4", dist: { tarball: "http://127.0.0.1/unused" } },
                  },
                  time: { "2.0.2": "2025-01-01T00:00:00Z", "2.3.4": "2025-01-02T00:00:00Z" },
                }),
            }),
          ),
          (server) => Effect.promise(() => server.stop(true)),
        )
        const test = yield* fixture(
          async (command, root) => {
            // Supply an already-installed target instead of downloading a real release.
            // All discovery, selection and config writes still run through mise itself.
            if (command.args[0] === "use" || command.args[0] === "install")
              mkdirSync(path.join(root, misePaths({ version: "2.3.4" }).directory), { recursive: true })
            const child = Bun.spawn([command.command, ...command.args], {
              cwd: root,
              env: {
                PATH: process.env.PATH,
                HOME: path.join(root, "home"),
                MISE_DATA_DIR: path.join(root, "custom-data"),
                MISE_CACHE_DIR: path.join(root, "cache"),
                MISE_STATE_DIR: path.join(root, "state"),
                MISE_CONFIG_DIR: path.join(root, "config"),
                npm_config_registry: registry.url.toString(),
                MISE_USE_VERSIONS_HOST: "false",
                MISE_PIN: "1",
                MISE_MINIMUM_RELEASE_AGE: "0",
              },
              stdout: "pipe",
              stderr: "pipe",
              timeout: 10_000,
            })
            const [exitCode, stdout, stderr] = await Promise.all([
              child.exited,
              new Response(child.stdout).arrayBuffer(),
              new Response(child.stderr).arrayBuffer(),
            ])
            expect(exitCode, Buffer.from(stderr).toString()).toBe(0)
            return { exitCode, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) }
          },
          "@opencode/cli",
          false,
          misePaths().executable,
        )
        yield* test.fs.writeFileString(
          path.join(test.root, path.dirname(misePaths().directory), ".mise.backend.toml"),
          'short = "npm:@opencode/cli"\nfull = "npm:@opencode/cli"\nexplicit_backend = true\n',
        )
        const config = path.join(test.root, "config/config.toml")
        yield* test.fs.makeDirectory(path.dirname(config), { recursive: true })
        yield* test.fs.makeDirectory(path.join(test.root, "home"), { recursive: true })
        yield* test.fs.writeFileString(
          config,
          `[tools]\n"npm:@opencode/cli" = { version = "${requested}", allow_builds = ["@opencode/cli"], allow_low_downloads = true }\n`,
        )
        yield* test.updater.apply("2.3.4")
        // Mise versions may serialize backend booleans as strings; both preserve the option.
        expect(
          [true, "true"].map((allow_low_downloads) => ({
            tools: {
              "npm:@opencode/cli": {
                version: requested === "2.0" ? "2.3" : requested === "2.0.2" ? "2.3.4" : requested,
                allow_builds: ["@opencode/cli"],
                allow_low_downloads,
              },
            },
          })),
        ).toContainEqual<object>(Bun.TOML.parse(yield* test.fs.readFileString(config)))
      }),
    )
  })
}

it.live("bun ignores install cache cleanup failures", () =>
  Effect.gen(function* () {
    const test = yield* fixture(() => ({}), "@opencode/cli", true)
    yield* test.updater.upgrade("bun", "v2.3.4-beta.1")
    expect(test.commands).toHaveLength(1)
  }),
)
;["success", "download", "install"].forEach((failure) => {
  it.live(`curl uses the V2 installer and cleans its directory: ${failure}`, () =>
    Effect.gen(function* () {
      const test = yield* fixture((command) => {
        const installer = command.command === "curl" ? command.args[2] : command.args[0]
        expect(existsSync(path.dirname(installer))).toBe(true)
        return {
          exitCode: command.command === (failure === "download" ? "curl" : failure === "install" ? "bash" : "") ? 1 : 0,
          stderr: Buffer.from(`${failure} failed`),
        }
      })
      const result = yield* test.updater.upgrade("curl", "v2.3.4-beta.1").pipe(Effect.flip, Effect.option)
      const installer = test.commands[0]?.[3]
      expect(installer).toStartWith(path.join(test.global.cache, "update-"))
      expect(test.commands).toEqual([
        ["curl", "-fsSL", "-o", installer, "https://opencode.ai/v2/install"],
        ...(failure === "download" ? [] : [["bash", installer, "--version", "2.3.4-beta.1", "--no-modify-path"]]),
      ])
      expect(yield* test.fs.readDirectory(test.global.cache)).toEqual([])
      expect(result._tag).toBe(failure === "success" ? "None" : "Some")
      if (result._tag === "Some") expect(result.value.message).toBe(`${failure} failed`)
    }),
  )
})

it.live("invalid version targets never execute a command or create a cache", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    yield* Effect.forEach(Updater.methods, (method) =>
      Effect.forEach(
        ["", "latest", "2.3", "01.2.3", "vv2.3.4", "2.3.4; echo unsafe", "--global", "v2.3.4\n--force"],
        (version) =>
          Effect.gen(function* () {
            const error = yield* test.updater.upgrade(method, version).pipe(Effect.flip)
            expect(error.message).toBe(`Invalid version: ${version}`)
          }),
      ),
    )
    expect(test.commands).toEqual([])
    expect(yield* test.fs.exists(test.global.cache)).toBe(false)
  }),
)

it.live("install failures expose stderr and process errors do not report success", () =>
  Effect.gen(function* () {
    const failed = yield* fixture(() => ({ exitCode: 1, stderr: Buffer.from("  registry denied access\n") }))
    const error = yield* failed.updater.upgrade("npm", "2.3.4").pipe(Effect.flip)
    expect(error.message).toBe("registry denied access")
    const missing = yield* fixture(() => ({ error: new AppProcess.AppProcessError({ command: "npm" }) }))
    const unavailable = yield* missing.updater.upgrade("npm", "2.3.4").pipe(Effect.flip)
    expect(unavailable.message).toBe("Failed to update with npm")
    expect(failed.commands).toHaveLength(1)
    expect(missing.commands).toHaveLength(1)
  }),
)
;(["npm", "pnpm", "bun", "yarn", undefined] as const).forEach((method) => {
  it.live(`method detection identifies ${method ?? "an unknown installation"} using the V2 package`, () =>
    Effect.gen(function* () {
      const test = yield* fixture((command) => ({
        stdout: Buffer.from(command.command === method ? "@opencode/cli@2.3.4" : "opencode-ai@1.0.0"),
      }))
      expect(yield* test.updater.method()).toBe(method)
      expect(test.commands).toEqual([
        ["npm", "list", "-g", "--depth=0", "@opencode/cli"],
        ["pnpm", "list", "-g", "--depth=0", "@opencode/cli"],
        ["bun", "pm", "ls", "-g"],
        ["yarn", "global", "list"],
      ])
    }),
  )
})

it.live("method detection tolerates unavailable package managers", () =>
  Effect.gen(function* () {
    const test = yield* fixture((command) =>
      command.command === "yarn"
        ? { stdout: Buffer.from("@opencode/cli@2.3.4") }
        : { error: new AppProcess.AppProcessError({ command: command.command }) },
    )
    expect(yield* test.updater.method()).toBe("yarn")
    expect(test.commands).toHaveLength(4)
  }),
)

function miseTool(root: string, requested = "latest", version = "2.0.2") {
  return {
    version,
    requested_version: requested,
    install_path: path.join(root, misePaths({ version }).directory),
    source: { type: "mise.toml", path: path.join(root, "mise config.toml") },
    installed: true,
    active: true,
  }
}

;[
  misePaths().executable,
  misePaths({ name: "@opencode/cli-node", binary: "opencode.exe" }).executable,
  "custom-data/installs/opencode/2.0.2/bin/opencode",
  ".local/share/mise/installs/npm-opencode-ai-cli/2.0.2/bin/opencode",
].forEach((location) => {
  it.live(`detects the resolved mise installation before global npm: ${location}`, () =>
    Effect.gen(function* () {
      const test = yield* fixture(() => ({ stdout: Buffer.from("@opencode/cli") }), "@opencode/cli", false, location)
      expect(yield* test.updater.method()).toBe("mise")
      expect(test.commands).toEqual([])
    }),
  )
})

it.live("mise detects platform binaries without a CLI package manifest", () =>
  Effect.gen(function* () {
    const test = yield* fixture(() => ({}), "@opencode/cli-darwin-arm64", false, misePaths().executable)
    expect(yield* test.updater.method()).toBe("mise")
    expect(test.commands).toEqual([])
  }),
)

it.live("global npm inside mise-managed Node remains an npm installation", () =>
  Effect.gen(function* () {
    const test = yield* fixture(
      (command) => ({ stdout: Buffer.from(command.command === "npm" ? "@opencode/cli" : "") }),
      "@opencode/cli",
      false,
      "custom-data/installs/node/24.0.0/lib/node_modules/@opencode/cli/bin/opencode",
    )
    expect(yield* test.updater.method()).toBe("npm")
  }),
)
;["bun", "node", "npm-opencode-cli-other"].forEach((tool) => {
  it.live(`does not mistake mise-managed ${tool} for a mise OpenCode install`, () =>
    Effect.gen(function* () {
      const test = yield* fixture(() => ({}), tool, false, `custom-data/installs/${tool}/2.0.2/bin/${tool}`)
      expect(yield* test.updater.method()).toBeUndefined()
      expect(test.commands).toEqual([])
    }),
  )
})
;[
  { before: "latest", after: "latest", pin: false, install: false },
  { before: "2", after: "2", pin: false, install: true },
  { before: "2.0", after: "2.3", pin: false, install: true },
  { before: "2.0.2", after: "2.3.4", pin: false, install: false },
  { before: "latest", after: "2.3.4", pin: true, install: false },
  { before: "2.0", after: "2.3.4", pin: true, install: false },
].forEach((selection) => {
  it.live(`mise selects ${selection.after} from ${selection.before} with explicit pin=${selection.pin}`, () =>
    Effect.gen(function* () {
      const used: string[] = []
      const test = yield* fixture(
        (command, root) => {
          if (command.args[0] === "use") used.push("use")
          return {
            stdout: Buffer.from(
              JSON.stringify([
                miseTool(root, used.length ? selection.after : selection.before, used.length ? "2.3.4" : "2.0.2"),
              ]),
            ),
          }
        },
        "@opencode/cli",
        false,
        misePaths().executable,
      )
      const config = path.join(test.root, "mise config.toml")
      const original = yield* test.fs.readFileString(config)
      yield* test.updater.upgrade("mise", "v2.3.4", { pin: selection.pin })
      expect(test.commands).toEqual([
        ["mise", "ls", "--current", "--json", "npm:@opencode/cli"],
        ...(selection.install ? [["mise", "install", "npm:@opencode/cli@2.3.4"]] : []),
        [
          "mise",
          "use",
          "--path",
          config,
          selection.after === "2.3.4" ? "--pin" : "--fuzzy",
          `npm:@opencode/cli@${selection.after}`,
        ],
        ["mise", "ls", "--current", "--json", "npm:@opencode/cli"],
      ])
      // Only mise owns config edits, including allow_builds and allow_low_downloads.
      expect(yield* test.fs.readFileString(config)).toBe(original)
    }),
  )
})

it.live("shared updater apply detects mise and verifies successful activation", () =>
  Effect.gen(function* () {
    const used: string[] = []
    const test = yield* fixture(
      (command, root) => {
        if (command.args[0] === "use") used.push("use")
        return { stdout: Buffer.from(JSON.stringify([miseTool(root, "latest", used.length ? "2.3.4" : "2.0.2")])) }
      },
      "@opencode/cli",
      false,
      misePaths().executable,
    )
    yield* test.updater.apply("2.3.4")
    expect(test.commands.every((command) => command[0] === "mise")).toBe(true)
    expect(used).toEqual(["use"])
  }),
)
;[".tool-versions", "mise.staging.toml"].forEach((file) => {
  it.live(`mise updates the selecting ${file} instead of creating a local config`, () =>
    Effect.gen(function* () {
      const used: string[] = []
      const test = yield* fixture(
        (command, root) => {
          if (command.args[0] === "use") used.push("use")
          return {
            stdout: Buffer.from(
              JSON.stringify([
                {
                  ...miseTool(root, used.length ? "2.3.4" : "2.0.2", used.length ? "2.3.4" : "2.0.2"),
                  source: { type: file === ".tool-versions" ? file : "mise.toml", path: path.join(root, file) },
                },
              ]),
            ),
          }
        },
        "@opencode/cli",
        false,
        misePaths().executable,
      )
      yield* test.fs.writeFileString(path.join(test.root, file), "fixture")
      yield* test.updater.apply("2.3.4")
      expect(test.commands[1]).toEqual([
        "mise",
        "use",
        "--path",
        path.join(test.root, file),
        "--pin",
        "npm:@opencode/cli@2.3.4",
      ])
      expect(yield* test.fs.exists(path.join(test.root, "mise.toml"))).toBe(false)
    }),
  )
})

const ambiguousMise: { name: string; tools: (root: string) => unknown }[] = [
  { name: "no active selection", tools: () => [] },
  { name: "multiple active versions", tools: (root) => [miseTool(root), miseTool(root, "2", "2.1.0")] },
  { name: "missing metadata", tools: () => [{}] },
  { name: "wrong version", tools: (root) => [{ ...miseTool(root), version: "2.0.1" }] },
  { name: "another install directory", tools: (root) => [{ ...miseTool(root), install_path: root }] },
  {
    name: "relative install path",
    tools: (root) => [{ ...miseTool(root), install_path: "installs/npm-opencode-cli/2.0.2" }],
  },
  { name: "inactive version", tools: (root) => [{ ...miseTool(root), active: false }] },
  { name: "uninstalled version", tools: (root) => [{ ...miseTool(root), installed: false }] },
  {
    name: "environment override",
    tools: (root) => [
      { ...miseTool(root), source: { type: "environment", key: "MISE_NPM_OPENCODE_CLI_VERSION", value: "2.0.2" } },
    ],
  },
  {
    name: "unknown source",
    tools: (root) => [{ ...miseTool(root), source: { type: "unknown", path: path.join(root, "mise config.toml") } }],
  },
  {
    name: "relative config",
    tools: (root) => [{ ...miseTool(root), source: { type: "mise.toml", path: "mise.toml" } }],
  },
  {
    name: "missing config",
    tools: (root) => [{ ...miseTool(root), source: { type: "mise.toml", path: path.join(root, "missing.toml") } }],
  },
  {
    name: "directory instead of config",
    tools: (root) => [{ ...miseTool(root), source: { type: "mise.toml", path: root } }],
  },
  { name: "unsupported alias", tools: (root) => [miseTool(root, "stable")] },
  { name: "path request", tools: (root) => [miseTool(root, "path:/other/install")] },
]

ambiguousMise.forEach((input) => {
  it.live(`mise refuses ${input.name} before modifying anything`, () =>
    Effect.gen(function* () {
      const test = yield* fixture(
        (command, root) => ({ stdout: Buffer.from(JSON.stringify(input.tools(root))) }),
        "@opencode/cli",
        false,
        misePaths().executable,
      )
      yield* test.updater.apply("2.3.4").pipe(Effect.flip)
      expect(test.commands).toEqual([["mise", "ls", "--current", "--json", "npm:@opencode/cli"]])
      expect(yield* test.fs.exists(path.join(test.root, "missing.toml"))).toBe(false)
    }),
  )
})
;["missing", "nonzero", "malformed"].forEach((failure) => {
  it.live(`mise ${failure} discovery never falls back to npm`, () =>
    Effect.gen(function* () {
      const test = yield* fixture(
        (command, root) => ({
          ...(failure === "missing" ? { error: new AppProcess.AppProcessError({ command: "mise" }) } : {}),
          exitCode: failure === "nonzero" ? 1 : 0,
          stdout: Buffer.from(failure === "malformed" ? "not json" : JSON.stringify([miseTool(root)])),
        }),
        "@opencode/cli",
        false,
        misePaths().executable,
      )
      expect(yield* test.updater.method()).toBe("mise")
      yield* test.updater.apply("2.3.4").pipe(Effect.flip)
      expect(test.commands).toEqual([["mise", "ls", "--current", "--json", "npm:@opencode/cli"]])
    }),
  )
})
;["install", "use", "activation"].forEach((failure) => {
  it.live(`mise ${failure} failure is not reported as installed`, () =>
    Effect.gen(function* () {
      const test = yield* fixture(
        (command, root) => ({
          stdout: Buffer.from(JSON.stringify([miseTool(root, "2")])),
          exitCode: command.args[0] === failure ? 1 : 0,
          stderr: Buffer.from(`mise ${failure} failed`),
        }),
        "@opencode/cli",
        false,
        misePaths().executable,
      )
      const error = yield* test.updater.apply("2.3.4").pipe(Effect.flip)
      expect(error.message).toContain(failure === "activation" ? "Mise did not select" : `mise ${failure} failed`)
      expect(test.commands).toHaveLength(failure === "install" ? 2 : failure === "use" ? 3 : 4)
    }),
  )
})

it.live("explicit mise requires ownership and refuses package migration", () =>
  Effect.gen(function* () {
    const unmanaged = yield* fixture()
    yield* unmanaged.updater.upgrade("mise", "2.3.4").pipe(Effect.flip)
    expect(unmanaged.commands).toEqual([])
    expect(unmanaged.updater.removal("mise")).toBeUndefined()
    const migrated = yield* fixture(
      (command, root) => ({ stdout: Buffer.from(JSON.stringify([miseTool(root)])) }),
      "@opencode/cli",
      false,
      misePaths().executable,
      "@opencode-ai/cli",
    )
    const error = yield* migrated.updater.upgrade("mise", "2.3.4").pipe(Effect.flip)
    expect(error.message).toContain("Reinstall npm:@opencode-ai/cli@2.3.4 with mise")
    expect(migrated.commands).toHaveLength(1)
  }),
)
;[0, 1].forEach((exitCode) => {
  it.live(`mise removal targets only the running version and handles exit ${exitCode}`, () =>
    Effect.gen(function* () {
      const test = yield* fixture(
        () => ({ exitCode, stderr: Buffer.from("mise uninstall failed") }),
        "@opencode/cli",
        false,
        misePaths().executable,
      )
      const removal = test.updater.removal("mise")
      if (!removal) return yield* Effect.die("Missing mise removal plan")
      expect(removal.command).toEqual(["mise", "uninstall", "npm:@opencode/cli@2.0.2"])
      expect(removal.note).toContain("Mise config entries are kept")
      expect(test.commands).toEqual([])
      const result = yield* removal.run.pipe(Effect.flip, Effect.option)
      expect(result._tag).toBe(exitCode === 0 ? "None" : "Some")
      if (result._tag === "Some") expect(result.value.message).toBe("mise uninstall failed")
      expect(test.commands).toEqual([["mise", "uninstall", "npm:@opencode/cli@2.0.2"]])
    }),
  )
})

it.live("mise removal refuses an unresolved version directory", () =>
  Effect.gen(function* () {
    const test = yield* fixture(() => ({}), "@opencode/cli", false, misePaths({ version: "latest" }).executable)
    expect(yield* test.updater.method()).toBe("mise")
    expect(test.updater.removal("mise")).toBeUndefined()
    expect(test.commands).toEqual([])
  }),
)

test("Node distribution honors the compile-time CLI name", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "test",
      import.meta.path,
      "--define",
      'OPENCODE_CLI_NAME="opencode2-node"',
      "--test-name-pattern",
      "^Node distribution resolves the published npm package$",
    ],
    {
      cwd: path.join(import.meta.dir, ".."),
      stdout: "ignore",
      stderr: "pipe",
      // Bun 1.4 can reuse cached modules compiled with different --define values.
      env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
    },
  )
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  expect(code, stderr).toBe(0)
  expect(stderr).toContain("1 pass")
})

if (typeof OPENCODE_CLI_NAME === "string" && OPENCODE_CLI_NAME === "opencode2-node") {
  it.live("Node distribution resolves the published npm package", () =>
    Effect.gen(function* () {
      const test = yield* fixture(
        (command) => ({
          stdout: Buffer.from(command.command === "npm" ? "@opencode/cli-node@2.3.4" : ""),
        }),
        "@opencode/cli-node",
      )
      expect(yield* test.updater.method()).toBe("npm")
      yield* test.updater.upgrade("npm", "v2.3.4")
      yield* test.updater.upgrade("pnpm", "v2.3.4")
      expect(test.commands).toEqual([
        ["npm", "list", "-g", "--depth=0", "@opencode/cli-node"],
        ["pnpm", "list", "-g", "--depth=0", "@opencode/cli-node"],
        ["bun", "pm", "ls", "-g"],
        ["yarn", "global", "list"],
        ["npm", "install", "--global", "@opencode/cli-node@2.3.4"],
        ["pnpm", "add", "--global", "--allow-build=@opencode/cli-node", "@opencode/cli-node@2.3.4"],
      ])
    }),
  )
}
