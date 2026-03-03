import * as path from "path"
import * as fs from "fs"
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath, runTests } from "@vscode/test-electron"
import { spawn } from "child_process"
import { VSBrowser } from "vscode-extension-tester"

const asyncFilter = async <T>(arr: T[], predicate: (item: T) => Promise<boolean>): Promise<T[]> => {
  const results = await Promise.all(arr.map(predicate))
  return arr.filter((_, i) => results[i])
}

export const platform = process.platform

export const extensionDevelopmentPath = path.join(__dirname, "../../")
export const extensionTestsPath = path.join(__dirname, "../../out/test/suite")

export const binaries: Record<string, string[]> = {
  linux: ["code-insiders"],
  win32: ["Code-Insiders.exe"],
  darwin: [],
}

async function findInsidersOnDarwin(): Promise<string | undefined> {
  const applicationsPath = "/Applications"
  if (!fs.existsSync(applicationsPath)) return undefined

  const entries = await fs.promises.readdir(applicationsPath)
  const insidersApps = entries.filter((e) => e.includes("Insiders") && e.endsWith(".app"))
  if (insidersApps.length === 0) return undefined

  return path.join(applicationsPath, insidersApps[0], "Contents/Resources/app/bin/code-insiders")
}

async function findInsidersOnLinux(): Promise<string | undefined> {
  const candidates = [
    path.join(__dirname, "../../.vscode-test/vscode-insiders/bin/code-insiders"),
    "/usr/bin/code-insiders",
    "/usr/local/bin/code-insiders",
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return undefined
}

async function findInsidersOnWin32(): Promise<string | undefined> {
  const candidates = [
    path.join(__dirname, "../../.vscode-test/vscode-insiders/Code-Insiders.exe"),
    "C:\\Program Files\\Microsoft VS Code Insiders\\Code - Insiders.exe",
    "C:\\Program Files (x86)\\Microsoft VS Code Insiders\\Code - Insiders.exe",
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return undefined
}

export async function resolveVSCode(): Promise<string> {
  const candidates = [
    path.join(__dirname, "../../.vscode-test/vscode-linux-x64-insiders"),
    path.join(__dirname, "../../.vscode-test/vscode-darwin-insiders"),
    path.join(__dirname, "../../.vscode-test/vscode-darwin-arm64-insiders"),
    path.join(__dirname, "../../.vscode-test/vscode-win32-insiders"),
    path.join(__dirname, "../../.vscode-test/vscode-insiders"),
  ]

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue

    const insidersBinary = path.join(candidate, platform === "win32" ? "Code-Insiders.exe" : "bin/code-insiders")
    if (fs.existsSync(insidersBinary)) return candidate
  }

  if (platform === "darwin") {
    const insiders = await findInsidersOnDarwin()
    if (insiders) return path.dirname(path.dirname(insiders))
  }

  if (platform === "linux") {
    const insiders = await findInsidersOnLinux()
    if (insiders) return path.dirname(path.dirname(insiders))
  }

  if (platform === "win32") {
    const insiders = await findInsidersOnWin32()
    if (insiders) return path.dirname(path.dirname(insiders))
  }

  throw new Error("Could not find VS Code Insiders. Please install it or run 'bun run pretest' to download it.")
}

export async function downloadInsiders(): Promise<void> {
  const version = "insiders"
  const candidates = [
    path.join(__dirname, "../../.vscode-test/vscode-linux-x64-insiders"),
    path.join(__dirname, "../../.vscode-test/vscode-darwin-insiders"),
    path.join(__dirname, "../../.vscode-test/vscode-darwin-arm64-insiders"),
    path.join(__dirname, "../../.vscode-test/vscode-win32-insiders"),
    path.join(__dirname, "../../.vscode-test/vscode-insiders"),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      console.log("VS Code Insiders already downloaded")
      return
    }
  }

  console.log("Downloading VS Code Insiders...")
  await downloadAndUnzipVSCode(version)
  console.log("VS Code Insiders downloaded successfully")
}

export async function run(testSuite: string, version: string = "insiders"): Promise<void> {
  const vscodeDir = await resolveVSCode()
  const vscodeExecutablePath =
    platform === "win32" ? path.join(vscodeDir, "Code-Insiders.exe") : path.join(vscodeDir, "code-insiders")
  const cliPath = path.join(vscodeDir, "bin", platform === "win32" ? "code-insiders.cmd" : "code-insiders")

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(cliPath, ["--install-extension", "sst-dev.opencode"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    })

    proc.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Failed to install extension. Exit code: ${code}`))
    })
  })

  const testWorkspace = path.join(__dirname, "../../.vscode-test-workspace")

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath: testSuite,
    launchArgs: [testWorkspace, "--disable-workspace-folders"],
  })
}

export async function ensureExtensionActivated(): Promise<void> {
  // Wait for extension to be activated by waiting for VS Code to fully load
  await new Promise((r) => setTimeout(r, 3000))
}
