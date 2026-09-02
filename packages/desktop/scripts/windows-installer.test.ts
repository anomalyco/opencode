import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

test.skipIf(process.platform !== "win32")(
  "installer grants sandbox access without changing unrelated permissions",
  async () => {
    const { getMakeNsisPath } = await import("app-builder-lib/out/toolsets/windows")
    const config = (await import("../electron-builder.config")).default
    const compiler = await getMakeNsisPath(config.toolsets?.nsis, config.nsis?.customNsisBinary)
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-installer-"))
    const run = async (cmd: string[]) => {
      const result = Bun.spawn(cmd, {
        env: { ...process.env, ...compiler.env, OPENCODE_INSTALLER_TEST_ROOT: dir },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(result.stdout).text(),
        new Response(result.stderr).text(),
        result.exited,
      ])
      expect(code, `${stdout}\n${stderr}`).toBe(0)
      return stdout.trim()
    }
    const acl = (file: string) =>
      run([
        "pwsh",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Acl -LiteralPath (Join-Path $env:OPENCODE_INSTALLER_TEST_ROOT '${file}')).Sddl`,
      ])

    try {
      await Bun.write(path.join(dir, "app/runtime/icudtl.dat"), "runtime fixture")
      await Bun.write(path.join(dir, "unrelated.txt"), "outside the installation")
      await run(["icacls.exe", path.join(dir, "app"), "/grant", "*S-1-15-2-999-999-999:(OI)(CI)(F)"])
      const parent = await acl(".")
      const unrelated = await acl("unrelated.txt")
      await Bun.write(
        path.join(dir, "installer.nsi"),
        `Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${path.join(dir, "installer.exe")}"
!include "${config.nsis?.include}"
Section
  StrCpy $INSTDIR "$EXEDIR\\app"
  !insertmacro customInstall
SectionEnd
`,
      )
      await run([compiler.path, path.join(dir, "installer.nsi")])
      await run([path.join(dir, "installer.exe")])
      const installed = await acl("app/runtime/icudtl.dat")
      expect(installed).toContain("(A;ID;0x1200a9;;;S-1-15-2-2)")
      expect(installed).toContain("S-1-15-2-999-999-999")
      await run([path.join(dir, "installer.exe")])
      expect(await acl("app/runtime/icudtl.dat")).toBe(installed)
      expect(await acl(".")).toBe(parent)
      expect(await acl("unrelated.txt")).toBe(unrelated)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  120_000,
)
