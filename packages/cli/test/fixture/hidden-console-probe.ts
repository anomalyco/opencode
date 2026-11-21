import { dlopen } from "bun:ffi"
import { HiddenConsole } from "../../src/services/hidden-console.bun"

const kernel32 = dlopen("kernel32.dll", {
  GetConsoleWindow: { args: [], returns: "u64" },
  GetConsoleProcessList: { args: ["buffer", "u32"], returns: "u32" },
})

const mode = process.argv[2]

if (mode === "child") {
  const pids = new Uint32Array(8)
  const count = kernel32.symbols.GetConsoleProcessList(pids, pids.length)
  const hwnd = Number(kernel32.symbols.GetConsoleWindow())
  kernel32.close()
  process.stdout.write(JSON.stringify({ count, hwnd }) + "\n")
  process.exit(0)
}

const before = new Uint32Array(8)
const beforeCount = kernel32.symbols.GetConsoleProcessList(before, before.length)
const status = HiddenConsole.attach()
// A second call sees the attached console and returns without replacing it.
const repeatStatus = HiddenConsole.attach()
const after = new Uint32Array(8)
const afterCount = kernel32.symbols.GetConsoleProcessList(after, after.length)
const hwnd = Number(kernel32.symbols.GetConsoleWindow())
kernel32.close()

// Spawn an unhidden console child (`Bun.spawn` defaults to windowsHide: false) to verify it
// inherits the service's windowless console instead of allocating a visible console window.
const child = Bun.spawn([process.execPath, "--no-config", import.meta.filename, "child"], {
  stdout: "pipe",
  stderr: "pipe",
})
const [childStdout, childStderr, childExit] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
])
if (childExit !== 0) {
  process.stderr.write(`child failed (${childExit}): ${childStderr}\n`)
  process.exit(1)
}

process.stderr.write("stderr-pipe-intact\n")
process.stdout.write(
  JSON.stringify({
    beforeCount,
    status,
    repeatStatus,
    afterCount,
    hwnd,
    child: JSON.parse(childStdout.trim()),
  }) + "\n",
)
