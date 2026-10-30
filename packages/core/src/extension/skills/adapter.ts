export * as SkillAdapter from "./adapter.js"

import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Extension } from "@opencode/schema/extension"
import { ConfigMarkdown } from "../../config/markdown.js"
import { ExtensionSecurity } from "../security.js"
import { ExtensionDetector } from "../detector.js"

export interface ParsedSkillMetadata {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version?: string
  readonly author?: string
  readonly license?: string
  readonly autoinvoke?: boolean
  readonly content: string
  readonly supportingFiles: string[]
}

export function parseSkillDirectory(
  sourceDir: string,
  files: string[],
  readFile: (filePath: string) => string | undefined,
): ParsedSkillMetadata {
  const skillFile = files.find((f) => path.basename(f) === "SKILL.md")
  const id = path.basename(sourceDir).toLowerCase().replace(/[^a-z0-9_-]/g, "-")

  if (skillFile) {
    const raw = readFile(skillFile) ?? ""
    const parsed = ConfigMarkdown.parseOption(raw)
    const data = (parsed?.data ?? {}) as Record<string, unknown>
    const name = typeof data.name === "string" ? data.name : id
    const description = typeof data.description === "string" ? data.description : `Skill for ${name}`
    const content = parsed?.content ?? raw

    return {
      id,
      name,
      description,
      version: typeof data.version === "string" ? data.version : "1.0.0",
      author: typeof data.author === "string" ? data.author : undefined,
      license: typeof data.license === "string" ? data.license : undefined,
      autoinvoke: data.autoinvoke === true,
      content,
      supportingFiles: files.filter((f) => path.basename(f) !== "SKILL.md"),
    }
  }

  // Fallback: look for other markdown files (e.g. README.md or instruction file)
  const mdFile = files.find((f) => f.endsWith(".md"))
  const raw = mdFile ? (readFile(mdFile) ?? "") : `# ${id}\n\nUniversal agent skill.`
  const name = id.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ")

  return {
    id,
    name,
    description: `Universal adapted skill for ${name}`,
    version: "1.0.0",
    content: raw,
    supportingFiles: files,
  }
}

export const inspect = Effect.fn("SkillAdapter.inspect")(function* (sourcePath: string) {
  const fs = yield* FSUtil.Service
  const stat = yield* fs.stat(sourcePath).pipe(Effect.orElseSucceed(() => undefined))
  if (!stat) return undefined

  const dir = stat.type === "File" ? path.dirname(sourcePath) : sourcePath
  const files = yield* fs.scan("**/*", {
    cwd: dir,
    absolute: false,
    include: "file",
    dot: true,
    ignore: FSUtil.ignoreGlobs,
  }).pipe(Effect.orElseSucceed(() => []))

  const fileMap = new Map<string, string>()
  for (const rel of files) {
    const content = yield* fs.readFileStringSafe(path.join(dir, rel)).pipe(Effect.orElseSucceed(() => undefined))
    if (content) fileMap.set(rel, content)
  }

  const parsed = parseSkillDirectory(dir, files, (rel) => fileMap.get(rel))
  const detection = yield* ExtensionDetector.detect(dir)
  const security = yield* ExtensionSecurity.scanDirectory(dir)

  const cir: Extension.CIR = {
    id: parsed.id,
    name: parsed.name,
    version: parsed.version ?? "1.0.0",
    category: "skill",
    originPlatform: detection.platform,
    source: {
      type: "local",
      location: sourcePath,
    },
    scope: "project",
    description: parsed.description,
    author: parsed.author,
    license: parsed.license,
    permissions: {
      filesystem: [sourcePath],
    },
    status: security.safe ? "installed" : "failed",
    enabled: security.safe,
    security,
    metadata: {
      autoinvoke: parsed.autoinvoke,
      supportingFilesCount: parsed.supportingFiles.length,
      platformConfidence: detection.confidence,
    },
  }

  return cir
})

export const install = Effect.fn("SkillAdapter.install")(function* (
  input: Extension.InstallInput,
  projectDir: string,
) {
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service

  const targetBase =
    input.targetScope === "global"
      ? path.join(global.config, "skills")
      : path.join(projectDir, ".opencode", "skills")

  yield* fs.ensureDir(targetBase).pipe(Effect.orElseSucceed(() => undefined))

  const sourcePath = input.sourceUrlOrPath
  const inspection = yield* inspect(sourcePath)
  if (!inspection) {
    return { success: false, error: "Failed to inspect source skill" }
  }

  if (inspection.security && !inspection.security.safe) {
    return {
      success: false,
      error: `Security scan rejected skill due to critical findings: ${inspection.security.findings.map((f) => f.message).join(", ")}`,
      security: inspection.security,
    }
  }

  const skillId = input.overrideName ? input.overrideName.toLowerCase().replace(/[^a-z0-9_-]/g, "-") : inspection.id
  const skillName = input.overrideName
    ? input.overrideName.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ")
    : inspection.name

  const targetDir = path.join(targetBase, skillId)

  // Copy directory structure safely
  const files = yield* fs.scan("**/*", {
    cwd: sourcePath,
    absolute: false,
    include: "file",
    dot: true,
    ignore: FSUtil.ignoreGlobs,
  }).pipe(Effect.orElseSucceed(() => []))

  for (const rel of files) {
    if (!ExtensionSecurity.isPathSafe(rel)) continue
    const srcFile = path.join(sourcePath, rel)
    const dstFile = path.join(targetDir, rel)
    const content = yield* fs.readFile(srcFile).pipe(Effect.orElseSucceed(() => undefined))
    if (content) {
      yield* fs.writeWithDirs(dstFile, content)
    }
  }

  // Ensure SKILL.md exists with proper frontmatter
  const targetSkillMd = path.join(targetDir, "SKILL.md")
  const exists = yield* fs.exists(targetSkillMd).pipe(Effect.orElseSucceed(() => false))
  if (!exists) {
    const frontmatter = [
      "---",
      `name: "${skillName}"`,
      `description: "${inspection.description ?? skillName}"`,
      "---",
      "",
      `# ${skillName}`,
      "",
      inspection.description ?? "",
    ].join("\n")
    yield* fs.writeFileString(targetSkillMd, frontmatter)
  }

  return {
    success: true,
    skillId,
    targetDirectory: targetDir,
    cir: {
      ...inspection,
      id: skillId,
      name: skillName,
      scope: input.targetScope,
      status: "enabled",
      enabled: true,
    },
  }
})
