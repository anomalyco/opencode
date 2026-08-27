import { describe, expect } from "bun:test"
import path from "node:path"
import { Cause, Effect, Exit, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Environment } from "@opencode-ai/core/environment/index"
import { EnvironmentUnavailable } from "@opencode-ai/core/environment/unavailable"
import { Location } from "@opencode-ai/core/location"
import { Shell } from "@opencode-ai/core/shell"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/util/global"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { tempGlobalLayer } from "./fixture/global"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const powershell = Bun.which("pwsh") ?? ""
const node = Bun.which("node") ?? ""
const nodes = LayerNode.group([Shell.node, Environment.node, Location.node])
const replacements = [
  [Global.node, tempGlobalLayer],
  [
    Location.node,
    Layer.effect(
      Location.Service,
      Effect.gen(function* () {
        const directory = yield* Effect.acquireRelease(
          Effect.promise(() => tmpdir()),
          (directory) => Effect.promise(() => directory[Symbol.asyncDispose]()),
        )
        return location(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))
      }),
    ),
  ],
] satisfies LayerNode.Replacements
const it = testEffect(AppNodeBuilder.build(nodes, replacements))
const unavailable = testEffect(
  AppNodeBuilder.build(nodes, [
    ...replacements,
    [
      Environment.node,
      Layer.succeed(Environment.Service, {
        spawner: EnvironmentUnavailable.spawner,
        files: Environment.makeFiles(Environment.makeLocalDriver(EnvironmentUnavailable.spawner)),
      }),
    ],
  ]),
)

describe.skipIf(process.platform !== "win32" || !powershell || !node)("package-backed Shell", () => {
  unavailable.live(
    "does not replace an unavailable environment with local execution",
    Effect.gen(function* () {
      const shell = yield* Shell.Service
      const location = yield* Location.Service
      const marker = path.join(location.directory, "must-not-run.txt")
      const exit = yield* Effect.exit(
        shell.create({
          shell: powershell,
          command: `[IO.File]::WriteAllText('${marker.replaceAll("'", "''")}', 'unexpected')`,
          timeout: 0,
        }),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("no execution plane")
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
    }),
    20000,
  )

  it.live(
    "preserves the default PowerShell code page and native pipeline decoding",
    Effect.gen(function* () {
      const environment = yield* Environment.Service
      const shell = yield* Shell.Service
      expect("spawnForeground" in environment.spawner).toBe(true)
      const info = yield* shell.create({
        shell: powershell,
        command:
          "[Console]::OutputEncoding.CodePage; $text = node -e 'process.stdout.write(Buffer.from([0x82]))'; if ($text -eq [string][char]0xe9) { Write-Output matched; exit 7 }; Write-Output mismatch; exit 9",
        timeout: 0,
      })
      const done = yield* shell.wait(info.id).pipe(Effect.timeout("10 seconds"))
      const output = yield* shell.output(info.id)
      expect(done.status).toBe("exited")
      expect(done.exit).toBe(7)
      expect(output.output).toBe("437\r\nmatched\r\n")
    }),
    20000,
  )

  it.live(
    "finishes with a retained writer only after the captured file is complete",
    Effect.gen(function* () {
      const shell = yield* Shell.Service
      const location = yield* Location.Service
      const pidFile = path.join(location.directory, "descendant.pid")
      yield* Effect.addFinalizer(() =>
        Effect.tryPromise({
          try: async () => {
            if (!(await Bun.file(pidFile).exists())) return
            process.kill(Number(await Bun.file(pidFile).text()))
          },
          catch: (cause) => cause,
        }).pipe(Effect.ignore),
      )
      const source = `const fs=require('fs');const child=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},15000)'],{detached:true,stdio:'inherit'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));child.unref();fs.writeSync(1,Buffer.alloc(1048576,97));fs.writeSync(1,'OUT-TAIL');fs.writeSync(2,'ERR-TAIL');process.exit(17)`
      const info = yield* shell.create({
        shell: powershell,
        command: `& '${node.replaceAll("'", "''")}' -e '${source.replaceAll("'", "''")}'; exit $LASTEXITCODE`,
        timeout: 0,
      })
      const done = yield* shell.wait(info.id).pipe(Effect.timeout("10 seconds"))
      const bytes = Buffer.from(yield* Effect.promise(() => Bun.file(info.file).arrayBuffer()))
      const page = yield* shell.output(info.id, { cursor: bytes.length - 16 })
      expect(done.status).toBe("exited")
      expect(done.exit).toBe(17)
      expect(bytes.length).toBe(1048592)
      expect(bytes.filter((byte) => byte === 97).length).toBe(1048576)
      expect(bytes.includes("OUT-TAIL")).toBe(true)
      expect(bytes.includes("ERR-TAIL")).toBe(true)
      expect(page.size).toBe(bytes.length)
      expect(page.cursor).toBe(bytes.length)
      const pid = Number(yield* Effect.promise(() => Bun.file(pidFile).text()))
      expect(() => process.kill(pid, 0)).not.toThrow()
    }),
    20000,
  )
})
