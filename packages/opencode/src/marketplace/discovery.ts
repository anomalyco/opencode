import { Log } from "../util/log"
import { MarketplaceSchema } from "./schema"
import { MarketplaceGitHub } from "./github"
import matter from "gray-matter"

export namespace MarketplaceDiscovery {
  const log = Log.create({ service: "marketplace.discovery" })

  // Common directories to scan for agents (in priority order)
  const AGENT_DIRECTORIES = [
    // Our convention
    "agents",
    "agent",
    // Claude Code conventions
    ".claude/agents",
    ".claude/skills",
    // Root level (for simple repos)
    "",
  ]

  // File patterns to look for
  const AGENT_FILE_PATTERNS = [
    /\.md$/i, // Any markdown file
  ]

  // Skill file pattern (Claude Code)
  const SKILL_FILE_PATTERN = /SKILL\.md$/i

  interface DiscoveredFile {
    path: string
    name: string
    isSkill: boolean
  }

  // Parse frontmatter from markdown content
  function parseFrontmatter(content: string): Record<string, unknown> | null {
    try {
      const parsed = matter(content)
      return parsed.data as Record<string, unknown>
    } catch {
      return null
    }
  }

  // Convert discovered file to AgentEntry
  function fileToAgentEntry(
    file: DiscoveredFile,
    frontmatter: Record<string, unknown>,
    content: string,
  ): MarketplaceSchema.AgentEntry {
    // Extract name from frontmatter or filename
    const name =
      (frontmatter.name as string) ||
      file.name.replace(/\.md$/i, "").replace(/^SKILL$/i, file.path.split("/").slice(-2)[0] || "skill")

    // Extract description
    const description =
      (frontmatter.description as string) ||
      (frontmatter.desc as string) ||
      // Try to get first paragraph from content
      extractFirstParagraph(content)

    // Map mode - support both our format and Claude Code format
    let mode: "subagent" | "primary" | "all" | undefined
    if (frontmatter.mode) {
      mode = frontmatter.mode as "subagent" | "primary" | "all"
    } else if (file.isSkill) {
      mode = "subagent" // Skills are typically subagents
    }

    // Extract tags
    let tags: string[] | undefined
    if (Array.isArray(frontmatter.tags)) {
      tags = frontmatter.tags as string[]
    } else if (typeof frontmatter.tags === "string") {
      tags = (frontmatter.tags as string).split(",").map((t) => t.trim())
    }
    // Claude Code uses "triggers" for skills
    if (Array.isArray(frontmatter.triggers)) {
      tags = [...(tags || []), ...(frontmatter.triggers as string[])]
    }

    return {
      path: file.path,
      name,
      description,
      mode,
      color: frontmatter.color as string | undefined,
      tags,
      version: frontmatter.version as string | undefined,
      author: frontmatter.author as string | undefined,
    }
  }

  // Extract first paragraph from markdown content (after frontmatter)
  function extractFirstParagraph(content: string): string | undefined {
    // Remove frontmatter
    const withoutFrontmatter = content.replace(/^---[\s\S]*?---\s*/, "")
    // Find first non-empty paragraph
    const lines = withoutFrontmatter.split("\n")
    const paragraphLines: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      // Skip headers and empty lines at start
      if (paragraphLines.length === 0 && (trimmed === "" || trimmed.startsWith("#"))) {
        continue
      }
      // Stop at empty line or header after we've started collecting
      if (paragraphLines.length > 0 && (trimmed === "" || trimmed.startsWith("#"))) {
        break
      }
      paragraphLines.push(trimmed)
    }

    const paragraph = paragraphLines.join(" ").trim()
    // Limit length
    if (paragraph.length > 200) {
      return paragraph.slice(0, 197) + "..."
    }
    return paragraph || undefined
  }

  // Check if a file looks like an agent/skill file
  function isAgentFile(filename: string): boolean {
    return AGENT_FILE_PATTERNS.some((pattern) => pattern.test(filename))
  }

  // Recursively list all markdown files in a directory
  async function listMarkdownFiles(
    repo: string,
    dirPath: string,
    ref?: string,
    maxDepth: number = 3,
    currentDepth: number = 0,
  ): Promise<DiscoveredFile[]> {
    if (currentDepth >= maxDepth) {
      return []
    }

    const files: DiscoveredFile[] = []

    try {
      const entries = await MarketplaceGitHub.listDirectory(repo, dirPath, ref)

      for (const entry of entries) {
        if (entry.type === "file" && isAgentFile(entry.name)) {
          files.push({
            path: entry.path,
            name: entry.name,
            isSkill: SKILL_FILE_PATTERN.test(entry.name),
          })
        } else if (entry.type === "dir") {
          // Recurse into subdirectories
          const subFiles = await listMarkdownFiles(repo, entry.path, ref, maxDepth, currentDepth + 1)
          files.push(...subFiles)
        }
      }
    } catch (error) {
      // Directory doesn't exist or access denied - that's ok
      log.debug("failed to list directory", { repo, dirPath, error })
    }

    return files
  }

  // Discover agents in a repository without registry.json
  export async function discoverAgents(
    source: MarketplaceSchema.Source,
  ): Promise<MarketplaceSchema.AgentEntry[]> {
    log.info("discovering agents", { repo: source.repo })

    const agents: MarketplaceSchema.AgentEntry[] = []
    const seenPaths = new Set<string>()

    // Determine base path
    const basePath = source.path || ""

    for (const dir of AGENT_DIRECTORIES) {
      const searchPath = basePath ? `${basePath}/${dir}`.replace(/^\/+/, "") : dir

      log.debug("scanning directory", { repo: source.repo, path: searchPath || "(root)" })

      const files = await listMarkdownFiles(source.repo, searchPath, source.ref)

      for (const file of files) {
        // Skip if we've already seen this file
        if (seenPaths.has(file.path)) {
          continue
        }
        seenPaths.add(file.path)

        try {
          // Fetch file content
          const { content } = await MarketplaceGitHub.getRawContent(source.repo, file.path, source.ref)

          // Parse frontmatter
          const frontmatter = parseFrontmatter(content)

          // Skip files without frontmatter or that don't look like agents
          if (!frontmatter) {
            log.debug("skipping file without frontmatter", { path: file.path })
            continue
          }

          // Check if it looks like an agent/skill file
          // Must have at least a description, prompt content, or be a SKILL.md
          const hasAgentIndicators =
            file.isSkill ||
            frontmatter.description ||
            frontmatter.mode ||
            frontmatter.model ||
            frontmatter.prompt ||
            frontmatter.tools ||
            frontmatter.permission

          if (!hasAgentIndicators) {
            log.debug("skipping file without agent indicators", { path: file.path })
            continue
          }

          const entry = fileToAgentEntry(file, frontmatter, content)
          agents.push(entry)

          log.debug("discovered agent", { name: entry.name, path: file.path })
        } catch (error) {
          log.debug("failed to process file", { path: file.path, error })
        }
      }
    }

    log.info("discovery complete", { repo: source.repo, count: agents.length })
    return agents
  }

  // Build a registry from discovered agents
  export async function buildRegistry(
    source: MarketplaceSchema.Source,
  ): Promise<MarketplaceSchema.RegistryIndex> {
    const agents = await discoverAgents(source)

    return {
      version: "1",
      name: source.name || source.repo.split("/").pop() || source.repo,
      description: `Auto-discovered agents from ${source.repo}`,
      types: ["agent"],
      agents,
    }
  }
}
