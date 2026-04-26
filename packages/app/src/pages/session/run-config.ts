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
const PROJECT_MARKER_FILES = new Set([
  "package.json",
  "go.mod",
  "pom.xml",
  "mvnw",
  "build.gradle",
  "build.gradle.kts",
  "build.sbt",
  "gradlew",
  "Cargo.toml",
  "Package.swift",
  "Makefile",
  "makefile",
])
const PROJECT_MARKER_QUERIES = [
  ...PROJECT_MARKER_FILES,
  "csproj",
]
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
  entrypoints?: {
    go?: string
    java?: string
    kotlin?: string
    python?: string
    scala?: string
    swift?: string
  }
  projectFiles?: {
    csharp?: string
  }
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

function directGoRunConfig(entry: string | undefined): RunConfig[] {
  if (!entry) return []
  return [{ id: "go.run", title: "Go run", command: `go run ${entry}` }]
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

function javaRunConfigs(entry: string | undefined): RunConfig[] {
  if (!entry) return []
  return [{ id: "java.run", title: "Java run", command: `java ${entry}` }]
}

function kotlinRunConfigs(entry: string | undefined): RunConfig[] {
  if (!entry) return []
  const jar = `${stripExtension(entry.split("/").pop() ?? entry)}.jar`
  return [{ id: "kotlin.run", title: "Kotlin run", command: `kotlinc ${entry} -include-runtime -d ${jar} && java -jar ${jar}` }]
}

function pythonRunConfigs(entry: string | undefined): RunConfig[] {
  if (!entry) return []
  return [{ id: "python.run", title: "Python run", command: `python ${entry}` }]
}

function scalaRunConfigs(entry: string | undefined): RunConfig[] {
  if (!entry) return []
  return [{ id: "scala.run", title: "Scala run", command: `scala ${entry}` }]
}

function sbtRunConfigs(enabled: boolean): RunConfig[] {
  if (!enabled) return []
  return [
    { id: "sbt.run", title: "sbt run", command: "sbt run" },
    { id: "sbt.test", title: "sbt test", command: "sbt test" },
  ]
}

function swiftRunConfigs(entry: string | undefined): RunConfig[] {
  if (!entry) return []
  return [{ id: "swift.run", title: "Swift run", command: `swift ${entry}` }]
}

function swiftPackageRunConfigs(enabled: boolean): RunConfig[] {
  if (!enabled) return []
  return [
    { id: "swift.package.run", title: "Swift run", command: "swift run" },
    { id: "swift.package.test", title: "Swift test", command: "swift test" },
  ]
}

function csharpRunConfigs(projectFile: string | undefined): RunConfig[] {
  if (!projectFile) return []
  return [
    { id: "dotnet.run", title: "Dotnet run", command: `dotnet run --project ${projectFile}` },
    { id: "dotnet.test", title: "Dotnet test", command: `dotnet test ${projectFile}` },
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

function shallowest(files: string[]) {
  return files.toSorted((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0]
}

function stripExtension(path: string) {
  const index = path.lastIndexOf(".")
  if (index <= 0) return path
  return path.slice(0, index)
}

function parentPath(path: string) {
  const index = path.lastIndexOf("/")
  if (index === -1) return ""
  return path.slice(0, index)
}

function lastPart(path: string) {
  const index = path.lastIndexOf("/")
  if (index === -1) return path
  return path.slice(index + 1)
}

function projectMarker(path: string) {
  const name = lastPart(path)
  if (PROJECT_MARKER_FILES.has(name)) return name
  if (name.endsWith(".csproj")) return ".csproj"
}

function isProjectMarker(value: string | undefined): value is string {
  return !!value
}

function isIgnoredPath(path: string) {
  return path.split("/").some((part) => IGNORED_PROJECT_DIRS.has(part))
}

function relativeToProject(projectPath: string, file: string) {
  if (!projectPath) return file
  if (!file.startsWith(`${projectPath}/`)) return file
  return file.slice(projectPath.length + 1)
}

async function searchFiles(client: OpencodeClient, query: string) {
  return client.find
    .files({ query, type: "file", dirs: "false", limit: 200 })
    .then((res) => res.data ?? [])
    .catch(() => [])
}

async function searchText(client: OpencodeClient, pattern: string, directory?: string) {
  return client.find
    .text(directory ? { pattern, directory } : { pattern })
    .then((res) => (res.data ?? []).map((item) => item.path.text))
    .catch(() => [])
}

async function resolveDirectoryAbsolute(client: OpencodeClient, path: string) {
  if (!path) return
  const entries = await listEntries(client, parentPath(path))
  return entries.find((node) => node.type === "directory" && node.path === path)?.absolute
}

async function markerCandidates(client: OpencodeClient) {
  const matches = await Promise.all(
    PROJECT_MARKER_QUERIES.map((query) =>
      searchFiles(client, query).then((paths) =>
        paths
          .flatMap((path) => {
            const marker = projectMarker(path)
            if (!marker || isIgnoredPath(path)) return []
            return [{ path: parentPath(path), marker, file: path }]
          }),
      ),
    ),
  )
  const grouped = new Map<string, { files: Set<string>; csharp: string[] }>()
  for (const match of matches.flat()) {
    const current = grouped.get(match.path) ?? { files: new Set<string>(), csharp: [] }
    current.files.add(match.marker)
    if (match.marker === ".csproj") current.csharp.push(relativeToProject(match.path, match.file))
    grouped.set(match.path, current)
  }
  return mapLimit([...grouped.entries()], 4, async ([path, value]) => ({
    path,
    absolute: await resolveDirectoryAbsolute(client, path),
    files: value.files,
    projectFiles: value.csharp.length ? { csharp: shallowest(value.csharp) } : undefined,
  }))
}

async function goEntrypoints(client: OpencodeClient, directory?: string) {
  const [mains, packages] = await Promise.all([
    searchText(client, "^func\\s+main\\s*\\(", directory),
    searchText(client, "^package\\s+main$", directory),
  ])
  const packageDirs = new Set(packages.filter((path) => path.endsWith(".go")).map(parentPath))
  return mains.filter((path) => path.endsWith(".go") && packageDirs.has(parentPath(path)))
}

async function sourceEntrypoints(client: OpencodeClient, pattern: string, extension: string, directory?: string) {
  return searchText(client, pattern, directory).then((paths) => paths.filter((path) => path.endsWith(extension)))
}

function entrypointProjectPath(entry: string, markers: ProjectCandidate[]) {
  const owner = markers
    .filter((project) => !project.path || entry === project.path || entry.startsWith(`${project.path}/`))
    .toSorted((a, b) => b.path.length - a.path.length)[0]
  if (owner) return owner.path
  return parentPath(entry)
}

async function entrypointCandidates(client: OpencodeClient, markers: ProjectCandidate[]) {
  const [goEntries, javaEntries, kotlinEntries, pythonEntries, scalaEntries, swiftEntries] = await Promise.all([
    goEntrypoints(client).then((paths) => paths.filter((path) => !isIgnoredPath(path))),
    sourceEntrypoints(client, "public\\s+static\\s+void\\s+main\\s*\\(", ".java").then((paths) =>
      paths.filter((path) => path.endsWith(".java") && !isIgnoredPath(path)),
    ),
    sourceEntrypoints(client, "fun\\s+main\\s*\\(", ".kt").then((paths) =>
      paths.filter((path) => path.endsWith(".kt") && !isIgnoredPath(path)),
    ),
    sourceEntrypoints(client, "if\\s+__name__\\s*==\\s*[\"']__main__[\"']\\s*:", ".py").then((paths) =>
      paths.filter((path) => !isIgnoredPath(path)),
    ),
    sourceEntrypoints(client, "@main|def\\s+main\\s*\\(", ".scala").then((paths) =>
      paths.filter((path) => !isIgnoredPath(path)),
    ),
    sourceEntrypoints(client, "@main|func\\s+main\\s*\\(", ".swift").then((paths) =>
      paths.filter((path) => !isIgnoredPath(path)),
    ),
  ])

  return mapLimit(
    [
      ...goEntries.map((path) => ({ path, mode: "go" as const })),
      ...javaEntries.map((path) => ({ path, mode: "java" as const })),
      ...kotlinEntries.map((path) => ({ path, mode: "kotlin" as const })),
      ...pythonEntries.map((path) => ({ path, mode: "python" as const })),
      ...scalaEntries.map((path) => ({ path, mode: "scala" as const })),
      ...swiftEntries.map((path) => ({ path, mode: "swift" as const })),
    ],
    4,
    async (entry) => {
      const projectPath = entrypointProjectPath(entry.path, markers)
      const owner = markers.find((project) => project.path === projectPath)
      return {
        path: projectPath,
        absolute: owner?.absolute ?? (await resolveDirectoryAbsolute(client, projectPath)),
        files: new Set(owner?.files ?? []),
        entrypoints:
          entry.mode === "go"
            ? { go: relativeToProject(projectPath, entry.path) }
            : entry.mode === "java"
            ? { java: relativeToProject(projectPath, entry.path) }
            : entry.mode === "kotlin"
            ? { kotlin: relativeToProject(projectPath, entry.path) }
            : entry.mode === "python"
            ? { python: relativeToProject(projectPath, entry.path) }
            : entry.mode === "scala"
            ? { scala: relativeToProject(projectPath, entry.path) }
            : { swift: relativeToProject(projectPath, entry.path) },
      } satisfies ProjectCandidate
    },
  )
}

function mergeProjectCandidates(projects: ProjectCandidate[]) {
  const merged = new Map<string, ProjectCandidate>()
  for (const project of projects) {
    const existing = merged.get(project.path)
    if (!existing) {
      merged.set(project.path, project)
      continue
    }
    merged.set(project.path, {
      ...existing,
      absolute: existing.absolute ?? project.absolute,
      files: new Set([...existing.files, ...project.files]),
      entrypoints: {
        ...project.entrypoints,
        ...existing.entrypoints,
      },
      projectFiles: {
        ...project.projectFiles,
        ...existing.projectFiles,
      },
    })
  }
  return [...merged.values()]
}

function projectCandidate(project: ProjectDir, entries: FileNode[]): ProjectCandidate | undefined {
  const files = new Set(
    entries.flatMap((node) => (node.type === "file" ? [projectMarker(node.path)].filter(isProjectMarker) : [])),
  )
  if (files.size === 0) return
  const csharp = shallowest(
    entries
      .filter((node) => node.type === "file" && node.name.endsWith(".csproj"))
      .map((node) => relativeToProject(project.path, node.path)),
  )
  return { ...project, files, projectFiles: csharp ? { csharp } : undefined }
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

  const markers = mergeProjectCandidates([
    projectCandidate({ path: "" }, rootEntries),
    ...topLevelEntries.map((item) => projectCandidate(item.dir, item.entries)),
    ...nestedEntries.map((item) => projectCandidate(item.dir, item.entries)),
    ...(await markerCandidates(client)),
  ].filter((candidate): candidate is ProjectCandidate => !!candidate))
  const entrypoints = await entrypointCandidates(client, markers)
  return mergeProjectCandidates([...markers, ...entrypoints])
}

async function detectEntrypoints(client: OpencodeClient, project: ProjectCandidate) {
  if (
    !project.entrypoints?.go &&
    !project.entrypoints?.java &&
    !project.entrypoints?.kotlin &&
    !project.entrypoints?.python &&
    !project.entrypoints?.scala &&
    !project.entrypoints?.swift &&
    !project.projectFiles?.csharp &&
    !project.files.has("go.mod") &&
    !project.files.has("pom.xml") &&
    !project.files.has("build.gradle") &&
    !project.files.has("build.gradle.kts") &&
    !project.files.has("build.sbt") &&
    !project.files.has("Package.swift")
  )
    return {}
  const [go, java, kotlin, python, scala, swift] = await Promise.all([
    project.entrypoints?.go
      ? project.entrypoints.go
      : project.files.has("go.mod")
      ? goEntrypoints(client, project.absolute).then(shallowest)
      : undefined,
    project.entrypoints?.java
      ? project.entrypoints.java
      : !project.files.has("pom.xml") && !project.files.has("build.gradle") && !project.files.has("build.gradle.kts")
      ? sourceEntrypoints(client, "public\\s+static\\s+void\\s+main\\s*\\(", ".java", project.absolute).then(shallowest)
      : undefined,
    project.entrypoints?.kotlin
      ? project.entrypoints.kotlin
      : !project.files.has("pom.xml") && !project.files.has("build.gradle") && !project.files.has("build.gradle.kts")
      ? sourceEntrypoints(client, "fun\\s+main\\s*\\(", ".kt", project.absolute).then(shallowest)
      : undefined,
    project.entrypoints?.python
      ? project.entrypoints.python
      : sourceEntrypoints(client, "if\\s+__name__\\s*==\\s*[\"']__main__[\"']\\s*:", ".py", project.absolute).then(shallowest),
    project.entrypoints?.scala
      ? project.entrypoints.scala
      : !project.files.has("build.sbt")
      ? sourceEntrypoints(client, "@main|def\\s+main\\s*\\(", ".scala", project.absolute).then(shallowest)
      : undefined,
    project.entrypoints?.swift
      ? project.entrypoints.swift
      : !project.files.has("Package.swift")
      ? sourceEntrypoints(client, "@main|func\\s+main\\s*\\(", ".swift", project.absolute).then(shallowest)
      : undefined,
  ])
  return { go, java, kotlin, python, scala, swift }
}

async function loadProjectDirRunConfigs(client: OpencodeClient, project: ProjectCandidate) {
  const entrypoints = await detectEntrypoints(client, project)
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
    ...(goMod
      ? [
          ...(entrypoints.go ? directGoRunConfig(entrypoints.go) : goRunConfigs(goMod).filter((config) => config.id === "go.run")),
          ...goRunConfigs(goMod).filter((config) => config.id !== "go.run"),
        ]
      : []),
    ...(!goMod ? directGoRunConfig(entrypoints.go) : []),
    ...(pom ? mavenRunConfigs(pom, project.files.has("mvnw") ? "./mvnw" : "mvn") : []),
    ...(gradle || gradleKts
      ? gradleRunConfigs(gradle ?? gradleKts ?? "", project.files.has("gradlew") ? "./gradlew" : "gradle")
      : []),
    ...(!pom && !gradle && !gradleKts ? javaRunConfigs(entrypoints.java) : []),
    ...(!pom && !gradle && !gradleKts ? kotlinRunConfigs(entrypoints.kotlin) : []),
    ...pythonRunConfigs(entrypoints.python),
    ...sbtRunConfigs(project.files.has("build.sbt")),
    ...(!project.files.has("build.sbt") ? scalaRunConfigs(entrypoints.scala) : []),
    ...swiftPackageRunConfigs(project.files.has("Package.swift")),
    ...(!project.files.has("Package.swift") ? swiftRunConfigs(entrypoints.swift) : []),
    ...csharpRunConfigs(project.projectFiles?.csharp),
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
