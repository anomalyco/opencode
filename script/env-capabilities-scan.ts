import { mkdir, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

type ToolInfo = {
  name: string
  available: boolean
  path?: string
  version?: string
}

const VERSION_FLAGS = ["--version", "-version", "version", "-v"]

const TOOL_GROUPS: Record<string, string[]> = {
  runtimes: ["node", "bun", "python", "python3", "php", "java", "go", "ruby", "dotnet"],
  packageManagers: ["npm", "pnpm", "yarn", "pip", "pip3", "composer", "cargo"],
  buildAndDev: ["git", "docker", "docker-compose", "make", "cmake", "ninja", "tsgo"],
  editorsAndOpeners: ["code", "cursor", "open", "xdg-open", "start", "explorer"],
  documentAndConversion: ["pandoc", "wkhtmltopdf", "weasyprint", "libreoffice", "soffice"],
}

const PROJECT_MARKERS = [
  "package.json",
  "bun.lock",
  "pnpm-lock.yaml",
  "yarn.lock",
  "composer.json",
  "requirements.txt",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "Dockerfile",
  ".tool-versions",
]

function lookupCommand(command: string): string | undefined {
  const locator = process.platform === "win32" ? "where" : "which"
  const found = spawnSync(locator, [command], { encoding: "utf8" })
  if (found.status !== 0) return undefined
  const first = found.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  return first || undefined
}

function readVersion(command: string): string | undefined {
  for (const flag of VERSION_FLAGS) {
    const result = spawnSync(command, [flag], { encoding: "utf8", timeout: 2000 })
    const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim()
    if (!output) continue
    const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    if (first) return first
  }
  return undefined
}

function inspectTool(name: string): ToolInfo {
  const commandPath = lookupCommand(name)
  if (!commandPath) return { name, available: false }
  return {
    name,
    available: true,
    path: commandPath,
    version: readVersion(name),
  }
}

function detectProjectMarkers(cwd: string) {
  return PROJECT_MARKERS.filter((marker) => existsSync(path.join(cwd, marker)))
}

function toMarkdown(report: any) {
  const lines: string[] = []
  lines.push("# Environment Capabilities")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Workspace: ${report.workspace}`)
  lines.push("")
  lines.push("## Platform")
  lines.push("")
  lines.push(`- OS: ${report.platform.os} ${report.platform.release}`)
  lines.push(`- Arch: ${report.platform.arch}`)
  lines.push(`- Shell: ${report.platform.shell}`)
  lines.push("")
  lines.push("## Project Markers")
  lines.push("")
  if (report.projectMarkers.length === 0) lines.push("- None detected")
  for (const marker of report.projectMarkers) lines.push(`- ${marker}`)
  lines.push("")

  for (const [group, tools] of Object.entries(report.tools as Record<string, ToolInfo[]>)) {
    lines.push(`## ${group}`)
    lines.push("")
    for (const tool of tools) {
      if (!tool.available) {
        lines.push(`- ${tool.name}: not found`)
        continue
      }
      const version = tool.version ? ` (${tool.version})` : ""
      lines.push(`- ${tool.name}: ${tool.path}${version}`)
    }
    lines.push("")
  }

  lines.push("## Usage Notes")
  lines.push("")
  lines.push("- Use this file as startup context for AI assistant capability-aware planning.")
  lines.push("- Re-run after installing tools or changing shell/OS environment.")
  return lines.join("\n")
}

async function main() {
  const workspace = process.cwd()
  const outputDir = path.join(workspace, ".opencode", "context")

  const tools = Object.fromEntries(
    Object.entries(TOOL_GROUPS).map(([group, commands]) => [group, commands.map((name) => inspectTool(name))]),
  )

  const report = {
    generatedAt: new Date().toISOString(),
    workspace,
    platform: {
      os: os.platform(),
      release: os.release(),
      arch: os.arch(),
      shell: process.env.SHELL || process.env.ComSpec || "unknown",
    },
    projectMarkers: detectProjectMarkers(workspace),
    tools,
  }

  await mkdir(outputDir, { recursive: true })
  await writeFile(path.join(outputDir, "env-capabilities.json"), JSON.stringify(report, null, 2), "utf8")
  await writeFile(path.join(outputDir, "env-capabilities.md"), toMarkdown(report), "utf8")

  console.log(`Wrote ${path.join(outputDir, "env-capabilities.json")}`)
  console.log(`Wrote ${path.join(outputDir, "env-capabilities.md")}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
