import { EOL } from "os"
import { Effect } from "effect"
import { Global } from "@opencode/util/global"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { databasePath } from "../../database-path"
import { bytes, inspect } from "./diagnostics"

export default Runtime.handler(
  Commands.commands.doctor,
  Effect.fn("cli.doctor")(function* () {
    const global = yield* Global.Service
    const db = databasePath(global.data)
    const report = yield* Effect.promise(() => inspect(global.data, db))

    const out = [
      ...section("paths", Object.entries(global).map(([key, value]) => [key, String(value)] as const)),
      ...section("data directory", [["total", bytes(report.total)] as const, ...report.children]),
      ...section("database", [
        ["path", db],
        ["size", report.database.size],
        ["wal", report.database.wal],
        ["shm", report.database.shm],
      ]),
      ...section("diagnostics", [
        ["orphaned temp files", String(report.orphaned)],
        ["executables on PATH", String(report.installs.length)],
      ]),
    ]

    if (report.installs.length > 1)
      out.push(
        ...indent(
          [
            `multiple opencode executables share ${global.data} and can corrupt the database:`,
            ...report.installs,
            "keep the one you intend to run and remove the rest",
          ],
          2,
        ),
        "",
      )

    process.stdout.write(out.join(EOL) + EOL)
  }),
)

function section(title: string, rows: ReadonlyArray<readonly [string, string]>) {
  const width = Math.max(0, ...rows.map(([key]) => key.length))
  return [title, ...rows.map(([key, value]) => `  ${key.padEnd(width)}  ${value}`), ""]
}

function indent(lines: ReadonlyArray<string>, depth: number) {
  return lines.map((line) => " ".repeat(depth) + line)
}
