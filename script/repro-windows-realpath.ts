// Run the compiled probe in an AppContainer with only an owned cwd granted.
// No account, provider, ACP session, network capability or drive-root grant.
import { lstatSync, readFileSync, realpathSync } from "node:fs"
import path from "node:path"
import { FSUtil } from "../packages/util/src/fs-util.js"

const visible = path.join(process.cwd(), "workspace")
const physical = realpathSync.native(visible)
const alias = path.join(visible, "alias")
const denied = path.parse(physical).root
const run = (name: string, work: () => boolean) => {
  try {
    return { name, ok: true, expected: work() }
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined
    return {
      name,
      ok: false,
      code: ["EPERM", "EACCES", "ENOENT", "ELOOP", "ENOTDIR"].includes(String(code)) ? code : "other",
    }
  }
}
const rows = [
  run("read_visible", () => readFileSync(path.join(visible, "inside.txt"), "utf8") === "synthetic"),
  run("read_physical", () => readFileSync(path.join(physical, "inside.txt"), "utf8") === "synthetic"),
  run("native_visible", () => realpathSync.native(visible) === physical),
  run("resolve_visible", () => FSUtil.resolve(visible) === physical),
  run("resolve_physical", () => FSUtil.resolve(physical) === physical),
  run("resolve_roundtrip", () => FSUtil.resolve(FSUtil.resolve(visible)) === physical),
  run("resolve_alias", () => FSUtil.resolve(alias) === realpathSync.native(path.join(physical, "real"))),
  run("missing", () => FSUtil.resolve(path.join(visible, "missing")) === path.join(visible, "missing")),
  run("root_lstat", () => {
    lstatSync(denied)
    return true
  }),
  run("root_resolve", () => FSUtil.resolve(denied) === denied),
]
console.log(JSON.stringify({ jsonrpc: "2.0", id: "realpath_probe", result: { runtime: Bun.version, rows } }))
