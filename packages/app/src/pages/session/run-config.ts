import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"

export type RunConfig = {
  id: string
  title: string
  command: string
  cwd?: string
}

export type CustomRunConfig = {
  name?: string
  command?: string
  cwd?: string
}

const COMMON_MAKE_TARGETS = new Set(["dev", "run", "start", "serve", "test", "build"])
const MARKER_FILES = new Set([
  "package.json",
  "go.mod",
  "pom.xml",
  "mvnw",
  "build.gradle",
  "build.gradle.kts",
  "gradlew",
  "Cargo.toml",
  "Makefile",
  "makefile",
])
const IGNORED_PROJECT_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".nuxt",
  ".turbo",
  ".vercel",
  "build",
  "dist",
  "node_modules",
  "target",
])

type ProjectDir = {
  path: string
  absolute?: string
}

type ProjectCandidate = ProjectDir & {
  files: Set<string>
}

type FileNode = {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function scriptCommand(manager: string | undefined, script: string) {
  if (manager === "bun") return `bun run ${script}`
  if (manager === "pnpm") return `pnpm run ${script}`
  if (manager === "yarn") return `yarn run ${script}`
  return `npm run ${script}`
}

function joinPath(dir: string, file: string) {
  if (!dir) return file
  return `${dir}/${file}`
}

function scopedRunConfigs(project: ProjectDir, configs: RunConfig[]) {
  if (!project.path) return configs
  return configs.map((config) => ({
    ...config,
    id: `${project.path}.${config.id}`,
    title: `${project.path}: ${config.title}`,
    cwd: project.absolute,
  }))
}

export function packageRunConfigs(content: string): RunConfig[] {
  const pkg = (() => {
    try {
      return JSON.parse(content) as unknown
    } catch {
      return undefined
    }
  })()
  if (!record(pkg)) return []
  if (!record(pkg.scripts)) return []

  const manager = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : undefined
  return Object.entries(pkg.scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name]) => ({
      id: `package.${name}`,
      title: name,
      command: scriptCommand(manager, name),
    }))
}

export function goRunConfigs(content: string): RunConfig[] {
  if (!content.trim()) return []
  return [
    { id: "go.run", title: "Go run", command: "go run ." },
    { id: "go.test", title: "Go test", command: "go test ./..." },
  ]
}

export function mavenRunConfigs(content: string, runner = "mvn"): RunConfig[] {
  if (!content.trim()) return []
  return [
    ...(content.includes("spring-boot")
      ? [{ id: "maven.spring-boot", title: "Spring Boot", command: `${runner} spring-boot:run` }]
      : []),
    { id: "maven.test", title: "Maven test", command: `${runner} test` },
  ]
}

export function gradleRunConfigs(content: string, runner = "gradle"): RunConfig[] {
  if (!content.trim()) return []
  return [
    ...(content.includes("org.springframework.boot") || content.includes("bootRun")
      ? [{ id: "gradle.boot-run", title: "Spring Boot", command: `${runner} bootRun` }]
      : []),
    ...(content.includes("application") || content.includes(" run") || content.includes('"run"')
      ? [{ id: "gradle.run", title: "Gradle run", command: `${runner} run` }]
      : []),
    { id: "gradle.test", title: "Gradle test", command: `${runner} test` },
  ]
}

export function cargoRunConfigs(content: string): RunConfig[] {
  if (!content.trim()) return []
  return [
    { id: "cargo.run", title: "Cargo run", command: "cargo run" },
    { id: "cargo.test", title: "Cargo test", command: "cargo test" },
  ]
}

export function makeRunConfigs(content: string): RunConfig[] {
  return content
    .split("\n")
    .flatMap((line) => {
      const match = /^([A-Za-z0-9_.-]+)\s*:(?![=])/.exec(line)
      if (!match?.[1] || !COMMON_MAKE_TARGETS.has(match[1])) return []
      return [{ id: `make.${match[1]}`, title: `make ${match[1]}`, command: `make ${match[1]}` }]
    })
    .filter((config, index, configs) => configs.findIndex((item) => item.id === config.id) === index)
}

async function readText(client: OpencodeClient, path: string) {
  return client.file
    .read({ path })
    .then((res) => (res.data?.type === "text" ? res.data.content : undefined))
    .catch(() => undefined)
}

async function yieldToScanner() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = []
  let index = 0

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const current = index++
        results[current] = await fn(items[current]!)
        await yieldToScanner()
      }
    }),
  )

  return results
}

async function listEntries(client: OpencodeClient, path: string) {
  return client.file
    .list({ path })
    .then((res) => (res.data ?? []) as FileNode[])
    .catch(() => [])
}

function childDirs(entries: FileNode[]) {
  return entries
    .filter((node) => node.type === "directory" && !node.ignored && !IGNORED_PROJECT_DIRS.has(node.name))
    .map((node) => ({ path: node.path, absolute: node.absolute }))
}

function projectCandidate(project: ProjectDir, entries: FileNode[]): ProjectCandidate | undefined {
  const files = new Set(
    entries.filter((node) => node.type === "file" && MARKER_FILES.has(node.name)).map((node) => node.name),
  )
  if (files.size === 0) return
  return { ...project, files }
}

async function discoverProjectDirs(client: OpencodeClient) {
  const rootEntries = await listEntries(client, "")
  const topLevel = childDirs(rootEntries)
  const topLevelEntries = await mapLimit(topLevel, 4, async (dir) => ({
    dir,
    entries: await listEntries(client, dir.path),
  }))
  const nested = topLevelEntries.flatMap((item) => childDirs(item.entries))
  const nestedEntries = await mapLimit(nested, 4, async (dir) => ({
    dir,
    entries: await listEntries(client, dir.path),
  }))

  return [
    projectCandidate({ path: "" }, rootEntries),
    ...topLevelEntries.map((item) => projectCandidate(item.dir, item.entries)),
    ...nestedEntries.map((item) => projectCandidate(item.dir, item.entries)),
  ].filter((candidate): candidate is ProjectCandidate => !!candidate)
}

async function loadProjectDirRunConfigs(client: OpencodeClient, project: ProjectCandidate) {
  const [pkg, goMod, pom, gradle, gradleKts, cargo, makefile, lowerMakefile] = await Promise.all([
    project.files.has("package.json") ? readText(client, joinPath(project.path, "package.json")) : undefined,
    project.files.has("go.mod") ? readText(client, joinPath(project.path, "go.mod")) : undefined,
    project.files.has("pom.xml") ? readText(client, joinPath(project.path, "pom.xml")) : undefined,
    project.files.has("build.gradle") ? readText(client, joinPath(project.path, "build.gradle")) : undefined,
    project.files.has("build.gradle.kts") ? readText(client, joinPath(project.path, "build.gradle.kts")) : undefined,
    project.files.has("Cargo.toml") ? readText(client, joinPath(project.path, "Cargo.toml")) : undefined,
    project.files.has("Makefile") ? readText(client, joinPath(project.path, "Makefile")) : undefined,
    project.files.has("makefile") ? readText(client, joinPath(project.path, "makefile")) : undefined,
  ])

  return scopedRunConfigs(project, [
    ...(pkg ? packageRunConfigs(pkg) : []),
    ...(goMod ? goRunConfigs(goMod) : []),
    ...(pom ? mavenRunConfigs(pom, project.files.has("mvnw") ? "./mvnw" : "mvn") : []),
    ...(gradle || gradleKts
      ? gradleRunConfigs(gradle ?? gradleKts ?? "", project.files.has("gradlew") ? "./gradlew" : "gradle")
      : []),
    ...(cargo ? cargoRunConfigs(cargo) : []),
    ...(makefile || lowerMakefile ? makeRunConfigs(makefile ?? lowerMakefile ?? "") : []),
  ])
}

export async function loadProjectRunConfigs(client: OpencodeClient) {
  const dirs = await discoverProjectDirs(client)
  return mapLimit(dirs, 4, (dir) => loadProjectDirRunConfigs(client, dir)).then((configs) => configs.flat())
}

export function runConfigList(input: {
  projectStart?: string
  projectStartTitle: string
  customRuns?: CustomRunConfig[]
  detectedRuns?: RunConfig[]
}) {
  const seen = new Set<string>()
  return [
    ...(input.projectStart
      ? [
          {
            id: "project.start",
            title: input.projectStartTitle,
            command: input.projectStart,
          },
        ]
      : []),
    ...(input.customRuns ?? []).flatMap((config, index) => {
      const command = config.command?.trim()
      if (!command) return []
      return [
        {
          id: `custom.${index}`,
          title: config.name?.trim() || command,
          command,
          cwd: config.cwd,
        },
      ]
    }),
    ...(input.detectedRuns ?? []),
  ].filter((config) => {
    const key = `${config.title}\n${config.command}\n${config.cwd ?? ""}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
