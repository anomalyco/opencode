import { expect, test } from "bun:test"
import { listInstalledWslDistros, probeWslRuntime, runWslSh, wslArgs } from "./runtime"

test("wslArgs bypasses the distro default shell", () => {
  expect(wslArgs(["sh", "-lc", 'printf "%s\\n" "$HOME"'], "Debian")).toEqual([
    "-d",
    "Debian",
    "--exec",
    "sh",
    "-lc",
    'printf "%s\\n" "$HOME"',
  ])
  expect(wslArgs(["bash", "-se"], "Debian", "root")).toEqual([
    "-d",
    "Debian",
    "--user",
    "root",
    "--exec",
    "bash",
    "-se",
  ])
})

// Exercise the real wsl.exe argv path: with `--`, WSL routes the command line through the distro's
// default shell, which expands `$cli` to "" before `sh` runs the script (#48640).
const distro =
  process.platform === "win32" && (await probeWslRuntime()).available
    ? (await listInstalledWslDistros().catch(() => [])).find((item) => item.isDefault)?.name
    : undefined

test.skipIf(!distro)("inline scripts keep their own variable expansion inside WSL", async () => {
  const result = await runWslSh(['cli="from-script"', 'printf "%s\\n" "$cli"'].join("\n"), distro)
  expect(result.code).toBe(0)
  expect(result.stdout.trim()).toBe("from-script")
})
