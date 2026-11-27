import { expect, test } from "bun:test"
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const windows = test.skipIf(process.platform !== "win32")

// Matches the 16 hex characters the staged directory name takes from APP_64_HASH.
const payloadHash = "0123456789ABCDEF0123456789ABCDEF"

// The installer clears the uninstall entry of an install it moves; the tests point it at their own key.
const uninstallKey = "Software\\OpenCodeInstallerTest"

async function harness() {
  const { getMakeNsisPath, getNsisPluginsPath } = await import("app-builder-lib/out/toolsets/windows")
  const { nsisTemplatesDir } = await import("app-builder-lib/out/targets/nsis/nsisUtil")
  const { NsisScriptGenerator } = await import("app-builder-lib/out/targets/nsis/nsisScriptGenerator")
  const config = (await import("../electron-builder.config")).default
  const compiler = await getMakeNsisPath(config.toolsets?.nsis, config.nsis?.customNsisBinary)
  const plugins = await getNsisPluginsPath(config.toolsets?.nsis, config.nsis?.customNsisResources)
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-installer-"))
  // electron-builder generates the command-line flags such as ${isUpdated}.
  const flags = new NsisScriptGenerator()
  flags.flags(["updated"])

  const run = async (cmd: string[], env: Record<string, string> = {}) => {
    const result = Bun.spawn(cmd, { env: { ...process.env, ...compiler.env, ...env }, stdout: "pipe", stderr: "pipe" })

    const [stdout, stderr, code] = await Promise.all([
      new Response(result.stdout).text(),
      new Response(result.stderr).text(),
      result.exited,
    ])

    return { stdout: stdout.trim(), stderr, code }
  }

  // Compiles the custom include with the template's flags and messages around one section body.
  const compile = async (name: string, section: string) => {
    const script = path.join(dir, `${name}.nsi`)
    const exe = path.join(dir, `${name}.exe`)
    await Bun.write(
      script,
      `Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${exe}"
!addplugindir /x86-unicode "${path.join(plugins, "x86-unicode")}"
!addincludedir "${path.join(nsisTemplatesDir, "include")}"
!include LogicLib.nsh
!include StdUtils.nsh
${flags.build()}
LoadLanguageFile "\${NSISDIR}\\Contrib\\Language files\\English.nlf"
LangString appRunning \${LANG_ENGLISH} "running"
LangString appClosing \${LANG_ENGLISH} "closing"
LangString appCannotBeClosed \${LANG_ENGLISH} "cannot close"
!define APP_EXECUTABLE_FILENAME "OpenCode.exe"
!define APP_ID "ai.opencode.desktop"
!define APP_FILENAME "@opencodedesktop"
!define UNINSTALL_FILENAME "Uninstall OpenCode.exe"
!define UNINSTALL_REGISTRY_KEY "${uninstallKey}"
!define SHORTCUT_NAME "OpenCode Installer Test"
!define APP_64 "${path.join(dir, "app.7z")}"
!define APP_64_HASH "${payloadHash}"
!define APP_64_UNPACKED_SIZE 1
!include "${config.nsis?.include}"
Section
${section}
SectionEnd
`,
    )
    const result = await run([compiler.path, script])
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0)

    return exe
  }

  return { dir, run, compile, compiler, plugins, nsisTemplatesDir, config, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

windows(
  "installer grants sandbox access without changing unrelated permissions",
  async () => {
    const installer = await harness()

    const succeed = async (cmd: string[]) => {
      const result = await installer.run(cmd, { OPENCODE_INSTALLER_TEST_ROOT: installer.dir })
      expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0)

      return result.stdout
    }

    const acl = (file: string) =>
      succeed([
        "pwsh",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Acl -LiteralPath (Join-Path $env:OPENCODE_INSTALLER_TEST_ROOT '${file}')).Sddl`,
      ])

    try {
      await Bun.write(path.join(installer.dir, "app/runtime/icudtl.dat"), "runtime fixture")
      await Bun.write(path.join(installer.dir, "unrelated.txt"), "outside the installation")
      await succeed(["icacls.exe", path.join(installer.dir, "app"), "/grant", "*S-1-15-2-999-999-999:(OI)(CI)(F)"])
      const parent = await acl(".")
      const unrelated = await acl("unrelated.txt")

      const exe = await installer.compile(
        "acl",
        `  StrCpy $INSTDIR "$EXEDIR\\app"
  !insertmacro customInstall`,
      )

      await succeed([exe])
      const installed = await acl("app/runtime/icudtl.dat")
      expect(installed).toContain("(A;ID;0x1200a9;;;S-1-15-2-2)")
      expect(installed).toContain("S-1-15-2-999-999-999")
      await succeed([exe])
      expect(await acl("app/runtime/icudtl.dat")).toBe(installed)
      expect(await acl(".")).toBe(parent)
      expect(await acl("unrelated.txt")).toBe(unrelated)
    } finally {
      await installer.cleanup()
    }
  },
  120_000,
)

// The running app unpacks an update beside the install directory before the restart. The install takes it
// only when it belongs to this payload and the old version is gone, and never leaves a staged copy behind.
const stagedCases = [
  {
    name: "moves the staged app into the emptied install directory",
    installed: [],
    staged: { [`update-${payloadHash.slice(0, 16)}`]: ["OpenCode.exe", "resources/app.asar"] },
    moved: true,
    expected: ["OpenCode.exe", "resources/app.asar"],
  },
  {
    name: "keeps an install directory that still holds files",
    installed: ["locked.dll"],
    staged: { [`update-${payloadHash.slice(0, 16)}`]: ["OpenCode.exe"] },
    moved: false,
    expected: ["locked.dll"],
  },
  {
    name: "discards an update staged from another payload",
    installed: [],
    staged: { "update-FEDCBA9876543210": ["OpenCode.exe"] },
    moved: false,
    expected: [],
  },
  {
    name: "discards staging that never finished",
    installed: [],
    staged: { staging: ["OpenCode.exe"] },
    moved: false,
    expected: [],
  },
]

windows(
  "installs a staged update only into an emptied install directory",
  async () => {
    const installer = await harness()

    try {
      const exe = await installer.compile(
        "staged",
        `  InitPluginsDir
  SetOutPath $INSTDIR
  !insertmacro customInstallStagedApp
  \${If} $R0 == "installed"
    SetErrorLevel 0
  \${Else}
    SetErrorLevel 3
  \${EndIf}`,
      )

      for (const item of stagedCases) {
        const root = path.join(installer.dir, item.name.replaceAll(" ", "-"))
        const install = path.join(root, "app")
        await mkdir(install, { recursive: true })
        await Promise.all([
          ...item.installed.map((file) => Bun.write(path.join(install, file), "old")),
          ...Object.entries(item.staged).flatMap(([suffix, files]) =>
            files.map((file) => Bun.write(path.join(`${install}.${suffix}`, file), "new")),
          ),
        ])

        const result = await installer.run([exe, `/D=${install}`])
        const files = await readdir(install, { recursive: true, withFileTypes: true })

        expect(result.code, item.name).toBe(item.moved ? 0 : 3)
        expect(
          files
            .filter((entry) => entry.isFile())
            .map((entry) => path.relative(install, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
            .toSorted(),
          item.name,
        ).toEqual(item.expected)
        expect(await readdir(root), item.name).toEqual(["app"])
      }
    } finally {
      await installer.cleanup()
    }
  },
  120_000,
)

// Every channel used to install into one directory named after the package. Each channel now installs into
// a directory named after its app ID and leaves the shared one without touching the other channels' files.
const directoryCases = [
  {
    name: "a first install uses the app ID",
    from: "@opencodedesktop",
    shared: [],
    expected: "ai.opencode.desktop",
    left: undefined,
    uninstallKept: true,
  },
  {
    name: "leaving the shared directory keeps the other channels",
    from: "@opencodedesktop",
    shared: [
      "OpenCode.exe",
      "Uninstall OpenCode.exe",
      "OpenCode Beta.exe",
      "Uninstall OpenCode Beta.exe",
      "resources/app.asar",
    ],
    expected: "ai.opencode.desktop",
    left: ["OpenCode Beta.exe", "Uninstall OpenCode Beta.exe", "resources/app.asar"],
    uninstallKept: false,
  },
  {
    name: "the last channel removes the shared directory",
    from: "@opencodedesktop",
    shared: ["OpenCode.exe", "Uninstall OpenCode.exe", "resources/app.asar"],
    expected: "ai.opencode.desktop",
    left: undefined,
    uninstallKept: false,
  },
  {
    name: "an install elsewhere stays where it is",
    from: "custom",
    shared: ["OpenCode.exe", "Uninstall OpenCode.exe"],
    expected: "custom",
    left: ["OpenCode.exe", "Uninstall OpenCode.exe"],
    uninstallKept: true,
  },
]

windows(
  "installs each channel into a directory named after its app ID",
  async () => {
    const installer = await harness()
    const registry = (args: string[]) => installer.run(["reg.exe", ...args, "/f"])

    try {
      const exe = await installer.compile(
        "directory",
        `  !insertmacro customInit
  FileOpen $0 "$EXEDIR\\instdir.txt" w
  FileWrite $0 $INSTDIR
  FileClose $0
  !insertmacro leaveSharedInstall`,
      )

      for (const item of directoryCases) {
        const root = path.join(installer.dir, item.name.replaceAll(" ", "-"))
        const from = path.join(root, item.from)
        await mkdir(root, { recursive: true })
        await Promise.all(item.shared.map((file) => Bun.write(path.join(from, file), "old")))
        await registry(["add", `HKCU\\${uninstallKey}`, "/v", "UninstallString", "/d", "uninstall"])

        expect((await installer.run([exe, `/D=${from}`])).code, item.name).toBe(0)
        expect(await Bun.file(path.join(installer.dir, "instdir.txt")).text(), item.name).toBe(
          path.join(root, item.expected),
        )

        const left = (await readdir(from, { recursive: true, withFileTypes: true }).catch(() => undefined))
          ?.filter((entry) => entry.isFile())
          .map((entry) => path.relative(from, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
          .toSorted()

        expect(left, item.name).toEqual(item.left)
        const query = await installer.run(["reg.exe", "query", `HKCU\\${uninstallKey}`, "/v", "UninstallString"])
        expect(query.code === 0, item.name).toBe(item.uninstallKept)
      }
    } finally {
      await installer.run(["reg.exe", "delete", `HKCU\\${uninstallKey}`, "/f"])
      await installer.cleanup()
    }
  },
  120_000,
)

// Stand-ins for the app are copies of ping.exe: it exits with 0 when it finishes and 1 when terminated.
const runningCases = [
  { name: "a manual install stops the app at once", args: [], pings: 30, exitCode: 1 },
  { name: "an update lets the quitting app exit by itself", args: ["--updated"], pings: 2, exitCode: 0 },
]

windows(
  "stops only the processes that run from the install directory",
  async () => {
    const installer = await harness()
    const ping = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "PING.EXE")

    try {
      const exe = await installer.compile("running", "  !insertmacro customCheckAppRunning")

      for (const item of runningCases) {
        const root = path.join(installer.dir, item.name.replaceAll(" ", "-"))
        const install = path.join(root, "app")
        // Shares the install directory's name as a prefix, so a match without the separator would stop it.
        const sibling = path.join(root, "app-sibling")
        await mkdir(path.join(install, "resources"), { recursive: true })
        await mkdir(sibling, { recursive: true })
        await copyFile(ping, path.join(install, "resources", "standin.exe"))
        await copyFile(ping, path.join(sibling, "standin.exe"))

        const app = Bun.spawn([path.join(install, "resources", "standin.exe"), "-n", String(item.pings), "127.0.0.1"], {
          stdout: "ignore",
        })

        const other = Bun.spawn([path.join(sibling, "standin.exe"), "-n", "30", "127.0.0.1"], { stdout: "ignore" })

        try {
          expect((await installer.run([exe, ...item.args, `/D=${install}`])).code, item.name).toBe(0)
          expect(other.exitCode, item.name).toBeNull()
          expect(await app.exited, item.name).toBe(item.exitCode)
        } finally {
          app.kill()
          other.kill()
          await Promise.all([app.exited, other.exited])
        }
      }
    } finally {
      await installer.cleanup()
    }
  },
  120_000,
)

// One-click updates used to flicker backwards during CHECK_APP_RUNNING loops and reset to 0% when
// Nsis7z::Extract ran. Verify the patched installer template compiles cleanly with zero warnings, and
// deterministically verify the monotonic progress controller, control re-IDing, 64-bit extraction math,
// and localized status updates against SpiderBanner without timing-sensitive window polling.
windows(
  "one-click installer progress controller stays strictly monotonic with localized status text",
  async () => {
    const installer = await harness()
    const { NsisScriptGenerator } = await import("app-builder-lib/out/targets/nsis/nsisScriptGenerator")

    const { LangConfigurator, addCustomMessageFileInclude, createAddLangsMacro } = await import(
      "app-builder-lib/out/targets/nsis/nsisLang"
    )

    const langEn = "$" + "{LANG_ENGLISH}"
    const flags = new NsisScriptGenerator()
    flags.flags(["updated", "force-run", "delete-app-data", "no-desktop-shortcut"])

    const compileStdin = async (script: string) => {
      const proc = Bun.spawn([installer.compiler.path, "-"], {
        cwd: installer.nsisTemplatesDir,
        env: { ...process.env, ...installer.compiler.env },
        stdin: new TextEncoder().encode(script),
        stdout: "pipe",
        stderr: "pipe",
      })

      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])

      expect(code, `${stdout}\n${stderr}`).toBe(0)

      return stdout
    }

    try {
      // 1. Real patched ONE_CLICK installer + messages.yml compile cleanly with zero warnings.
      const dummyPayload = path.join(installer.dir, "app.7z")
      const uninstExe = path.join(installer.dir, "uninst.exe")
      const instExe = path.join(installer.dir, "inst.exe")
      await Bun.write(dummyPayload, new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))
      await compileStdin(
        ["Unicode true", "RequestExecutionLevel user", "SilentInstall silent", `OutFile "${uninstExe}"`, "Section", "SectionEnd"].join(
          "\n",
        ),
      )

      const langConfig = new LangConfigurator({ multiLanguageInstaller: false })
      const langGen = new NsisScriptGenerator()
      createAddLangsMacro(langGen, langConfig)
      await addCustomMessageFileInclude(
        "messages.yml",
        { getTempFile: async (name: string) => path.join(installer.dir, name) },
        langGen,
        langConfig,
      )

      const compileOut = await compileStdin(
        [
          "Unicode true",
          `OutFile "${instExe}"`,
          `InstallDir "${path.join(installer.dir, "app")}"`,
          "!define ONE_CLICK",
          '!define PRODUCT_NAME "OpenCode"',
          '!define PRODUCT_FILENAME "OpenCode"',
          '!define VERSION "2.0.0"',
          '!define APP_ID "ai.opencode.desktop.progress-test"',
          '!define APP_FILENAME "opencode-progress-test"',
          '!define SHORTCUT_NAME "OpenCode Progress Test"',
          `!define INSTALL_REGISTRY_KEY "${uninstallKey}"`,
          `!define UNINSTALL_REGISTRY_KEY "${uninstallKey}"`,
          '!define UNINSTALL_APP_KEY "opencode-progress-test"',
          '!define UNINSTALL_DISPLAY_NAME "OpenCode Progress Test"',
          `!define UNINSTALLER_OUT_FILE "${uninstExe}"`,
          '!define APP_GUID "opencode-progress-test"',
          `!define APP_64 "${dummyPayload}"`,
          `!define APP_64_HASH "${payloadHash}"`,
          "!define APP_64_UNPACKED_SIZE 3000",
          "!define ESTIMATED_SIZE 3000",
          '!define APP_INSTALLER_STORE_FILE "opencode-progress-test.exe"',
          '!define COMPRESSION_METHOD "7z"',
          "!define DO_NOT_CREATE_START_MENU_SHORTCUT",
          "!define DO_NOT_CREATE_DESKTOP_SHORTCUT",
          `!addplugindir /x86-unicode "${path.join(installer.plugins, "x86-unicode")}"`,
          `!addincludedir "${installer.nsisTemplatesDir}"`,
          `!addincludedir "${path.join(installer.nsisTemplatesDir, "include")}"`,
          "!include LogicLib.nsh",
          "!include StdUtils.nsh",
          "!include FileFunc.nsh",
          "!include MUI2.nsh",
          flags.build(),
          langGen.build(),
          `!include "${installer.config.nsis?.include}"`,
          '!include "installer.nsi"',
        ].join("\n"),
      )

      expect(compileOut.split("\n").filter((line) => /warning/i.test(line))).toEqual([])

      // 2. Deterministic runtime check of the real patched progress functions against SpiderBanner.
      // Extract the patched progress block directly from installer.nsi so we test production code as shipped.
      const nsiSource = await Bun.file(path.join(installer.nsisTemplatesDir, "installer.nsi")).text()
      const start = nsiSource.indexOf("Var /GLOBAL progressBarHwnd")
      const end = nsiSource.indexOf("Function runInstallSection")
      expect(start).toBeGreaterThan(-1)
      expect(end).toBeGreaterThan(start)
      const progressBlock = nsiSource.slice(start, end)

      const traceFile = path.join(installer.dir, "trace.txt")
      const checkExe = path.join(installer.dir, "check-progress.exe")
      await compileStdin(
        [
          "Unicode true",
          "RequestExecutionLevel user",
          `OutFile "${checkExe}"`,
          `!addplugindir /x86-unicode "${path.join(installer.plugins, "x86-unicode")}"`,
          `!addincludedir "${path.join(installer.nsisTemplatesDir, "include")}"`,
          "!include MUI2.nsh",
          "!include LogicLib.nsh",
          "!insertmacro MUI_PAGE_INSTFILES",
          '!insertmacro MUI_LANGUAGE "English"',
          `LangString extracting ${langEn} "Extracting..."`,
          progressBlock,
          "Var LogH",
          "Var BannerPb",
          "Function Record",
          "  Exch $0",
          "  Push $1",
          "  Push $2",
          "  SendMessage $BannerPb 0x0408 0 0 $1",
          '  System::Call "user32::GetWindowTextW(p $bannerTextHwnd, t .r2, i 256)"',
          '  FileWrite $LogH "$0|$1|$2$\\r$\\n"',
          "  Pop $2",
          "  Pop $1",
          "  Pop $0",
          "FunctionEnd",
          "Function RunCheck",
          `  FileOpen $LogH "${traceFile}" w`,
          "  SpiderBanner::Show /MODERN",
          '  FindWindow $0 "#32770" "" $HWNDPARENT',
          '  FindWindow $1 "#32770" "" $HWNDPARENT $0',
          '  System::Call "user32::SetWindowPos(p $1, p 0, i -32000, i -32000, i 0, i 0, i 0x15)"',
          '  FindWindow $BannerPb "msctls_progress32" "" $1',
          "  Call initInstallProgress",
          // Verify original control ID 1004 is gone so Nsis7z cannot look it up and reset the bar.
          "  GetDlgItem $2 $0 1004",
          '  FileWrite $LogH "id1004|$2|$\\r$\\n"',
          "  !insertmacro setInstallProgress 13500",
          '  Push "set13500"',
          "  Call Record",
          // Backwards update must be ignored.
          "  !insertmacro setInstallProgress 6000",
          '  Push "back6000"',
          "  Call Record",
          // Monotonic creep respects cap.
          "  !insertmacro advanceInstallProgress 300 14000",
          '  Push "adv1"',
          "  Call Record",
          "  !insertmacro advanceInstallProgress 300 14000",
          '  Push "adv2"',
          "  Call Record",
          // 64-bit extraction callback: 350 MiB of 700 MiB -> exact midpoint 19500 (13500 + 6000).
          "  Push 734003200",
          "  Push 367001600",
          "  Call onExtractProgress",
          '  Push "extract50"',
          "  Call Record",
          // Upper clamp at 30000.
          "  !insertmacro setInstallProgress 99999",
          '  Push "clamp"',
          "  Call Record",
          "  FileClose $LogH",
          "  SetErrorLevel 0",
          "  Quit",
          "FunctionEnd",
          "Section",
          "  Call RunCheck",
          "SectionEnd",
        ].join("\n"),
      )

      expect((await installer.run([checkExe])).code).toBe(0)

      const rows = (await Bun.file(traceFile).text())
        .trim()
        .split(/\r?\n/)
        .map((line) => line.split("|"))

      expect(rows).toEqual([
        ["id1004", "0", ""],
        ["set13500", "13500", "Installing, Please Wait..."],
        ["back6000", "13500", "Installing, Please Wait..."],
        ["adv1", "13800", "Installing, Please Wait..."],
        ["adv2", "14000", "Installing, Please Wait..."],
        ["extract50", "19500", "Extracting... 350 / 700 MB"],
        ["clamp", "30000", "Extracting... 350 / 700 MB"],
      ])
    } finally {
      await installer.cleanup()
    }
  },
  120_000,
)
