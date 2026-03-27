// packages/opencode/src/workflow/index.ts
import path from "path"
import { z } from "zod"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { ConfigMarkdown } from "../config/markdown"
import { resolveSource } from "./registry"
import { validateWorkflowPath } from "./sandbox"
import { Log } from "../util/log"
import fs from "fs/promises"

const log = Log.create({ service: "workflow" })

export namespace Workflow {
  /** Zod schema for WORKFLOW.md frontmatter */
  export const Info = z.object({
    name: z.string().min(1),
    version: z.string().optional(),
    description: z.string().optional(),
    commands: z.array(z.string()).optional(),
  })

  export type Info = z.infer<typeof Info>

  /** Resolved path to the workflows base directory */
  export function workflowsDir(): string {
    return path.join(Global.Path.config, "workflows")
  }

  /** Read the config file path */
  function configPath(): string {
    return path.join(Global.Path.config, "opencode.json")
  }

  /**
   * Parse the WORKFLOW.md manifest from a workflow directory.
   * Returns null if WORKFLOW.md does not exist or is invalid.
   */
  export async function parseManifest(dir: string): Promise<Info | null> {
    const manifestPath = path.join(dir, "WORKFLOW.md")
    try {
      const md = await ConfigMarkdown.parse(manifestPath)
      return Info.parse(md.data)
    } catch {
      return null
    }
  }

  /**
   * List all installed workflows by reading workflow.paths from opencode.json
   * and loading WORKFLOW.md from each registered directory.
   */
  export async function list(): Promise<Array<Info & { path: string }>> {
    let existing: any = {}
    try {
      existing = await Filesystem.readJson(configPath())
    } catch {}
    const paths: string[] = existing?.workflow?.paths ?? []
    const results: Array<Info & { path: string }> = []
    for (const p of paths) {
      const expanded = p.startsWith("~/") ? path.join(process.env.HOME ?? "", p.slice(2)) : p
      const info = await parseManifest(expanded)
      if (info) results.push({ ...info, path: expanded })
      else log.warn("workflow directory missing or invalid WORKFLOW.md", { path: expanded })
    }
    return results
  }

  /**
   * Install a workflow from a source (alias or URL).
   * Clones into ~/.config/opencode/workflows/<name>/ and registers in opencode.json.
   * Idempotent: does nothing if path already registered.
   */
  export async function install(source: string): Promise<void> {
    const url = resolveSource(source)

    // Derive target directory name from URL basename (strip .git suffix)
    const urlName = url.split("/").pop()?.replace(/\.git$/, "") ?? source
    const destDir = path.join(workflowsDir(), urlName)

    // Sandbox check: destDir must stay inside workflowsDir()
    validateWorkflowPath(destDir)

    // Ensure workflows directory exists
    await fs.mkdir(workflowsDir(), { recursive: true })

    const alreadyCloned = await Filesystem.exists(destDir)
    if (!alreadyCloned) {
      log.info("cloning workflow", { url, destDir })
      const proc = Bun.spawnSync(["git", "clone", url, destDir], { stderr: "pipe" })
      if (proc.exitCode !== 0) {
        const stderr = new TextDecoder().decode(proc.stderr)
        throw new Error(`git clone failed: ${stderr}`)
      }
    }

    // Validate manifest
    const info = await parseManifest(destDir)
    if (!info) {
      throw new Error(`Cloned directory at ${destDir} has no valid WORKFLOW.md. Cannot register.`)
    }

    // Warn if directory name and manifest name differ
    if (info.name !== urlName) {
      log.warn("workflow name mismatch", { dirName: urlName, manifestName: info.name })
    }

    // Update config — dedup before writing (WF-07)
    let existing: any = {}
    try {
      existing = await Filesystem.readJson(configPath())
    } catch {}
    const currentPaths: string[] = existing?.workflow?.paths ?? []
    if (currentPaths.includes(destDir)) {
      log.info("workflow already registered, skipping", { path: destDir })
      return
    }
    const updated = {
      ...existing,
      workflow: { ...existing?.workflow, paths: [...currentPaths, destDir] },
    }
    await Filesystem.writeJson(configPath(), updated)
    log.info("workflow installed", { name: info.name, path: destDir })
  }

  /**
   * Remove a workflow by name. Deletes the directory and removes from config.
   */
  export async function remove(name: string): Promise<void> {
    let existing: any = {}
    try {
      existing = await Filesystem.readJson(configPath())
    } catch {}
    const currentPaths: string[] = existing?.workflow?.paths ?? []

    // Find path whose directory name or WORKFLOW.md name matches
    let targetPath: string | undefined
    for (const p of currentPaths) {
      const expanded = p.startsWith("~/") ? path.join(process.env.HOME ?? "", p.slice(2)) : p
      const dirName = path.basename(expanded)
      const info = await parseManifest(expanded)
      if (dirName === name || info?.name === name) {
        targetPath = expanded
        break
      }
    }

    if (!targetPath) {
      throw new Error(`Workflow "${name}" is not installed.`)
    }

    // Delete directory
    await fs.rm(targetPath, { recursive: true, force: true })

    // Remove from config
    const updatedPaths = currentPaths.filter((p) => p !== targetPath)
    const updated = {
      ...existing,
      workflow: { ...existing?.workflow, paths: updatedPaths },
    }
    await Filesystem.writeJson(configPath(), updated)
    log.info("workflow removed", { name, path: targetPath })
  }
}
