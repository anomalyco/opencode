import { expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { Shell } from "@opencode/core/shell"
import { ShellSelect } from "@opencode/core/shell/select"
import { Global } from "@opencode/util/global"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { it } from "./lib/effect"

// Git Bash re-splits its Windows command line, so these only exercise anything on Windows. gitbash() misses
// when git resolves to mingw64/bin, as it does inside a Git Bash session such as CI's.
const bash = process.platform === "win32" ? (ShellSelect.gitbash() ?? Bun.which("bash") ?? undefined) : undefined
const live = bash ? it.live : it.live.skip

const run = (command: string, timeout = 0) =>
  Effect.gen(function* () {
    const shell = yield* Shell.Service
    return yield* shell.result(yield* shell.create({ shell: bash, command, timeout }))
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(Shell.node, [
        Location.node.replace(tempLocationLayer),
        Global.node.replace(tempGlobalLayer),
        Config.node.replace(Config.testLayer()),
        Environment.node.replace(hostEnvironmentLayer),
      ]),
    ),
  )

live("passes backslashes and quotes to Git Bash unchanged", () =>
  Effect.gen(function* () {
    const text = String.raw`a\\b "c\"d" C:\e\\f\ g\\`
    expect(yield* run(`cat <<'EOF'\n${text}\nEOF\necho '${text}'\nexit 7`)).toMatchObject({
      info: { status: "exited", exit: 7 },
      capture: { output: `${text}\n${text}\n` },
    })
  }),
)

live("keeps the command as is when MSYS disables globbing", () =>
  Effect.sync(() => {
    // noglob splits the command line without collapsing backslashes, so encoding would double them.
    expect(ShellSelect.args(bash!, String.raw`a\\b`, { MSYS: "winsymlinks:nativestrict noglob" })).toEqual([
      "-c",
      String.raw`a\\b`,
    ])
  }),
)

live("ends a single command with its shell on timeout", () =>
  Effect.gen(function* () {
    // bash execs the last command of its -c string; a command that bash forks instead escapes tree kill.
    const duration = `30.${Date.now()}`
    expect((yield* run(`sleep ${duration}`, 1000)).info.status).toBe("timeout")
    const survivors = Bun.spawnSync([
      "powershell",
      "-NoProfile",
      "-Command",
      `@(Get-CimInstance Win32_Process -Filter "Name='sleep.exe'" | Where-Object CommandLine -like '*${duration}*').Length`,
    ])
    expect(survivors.stdout.toString().trim()).toBe("0")
  }),
)
