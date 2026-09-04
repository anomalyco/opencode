import { currentSession } from "../../utils/mock-server"

export const HOME_INDEX_FIXTURE_VERSION = 1

// Home shows the newest 64 root sessions; the fixture asserts that many rows.
export const HOME_INDEX_VISIBLE_LIMIT = 64

export type HomeIndexSession = {
  id: string
  projectID: string
  title?: string
  agent: string
  model: { id: string; providerID: string; variant: string }
  cost: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  outcome: "succeeded" | "failed" | "interrupted"
  time: { created: number; updated: number; idle: number; viewed?: number }
  location: { directory: string }
}

export type HomeIndexDirectory = {
  directory: string
  name: string
  projectID: string
  // Local project entries appear in the Home project list; the rest model
  // sessions whose project was removed from the sidebar.
  project: boolean
}

const repos = [
  "opencode",
  "storefront-api",
  "billing-worker",
  "design-system",
  "mobile-app",
  "infra-terraform",
  "docs-site",
  "analytics-pipeline",
  "auth-service",
  "legacy-admin",
  "notebooks",
  "dotfiles",
]

const verbs = [
  "Fix",
  "Investigate",
  "Refactor",
  "Add",
  "Remove",
  "Debug",
  "Migrate",
  "Implement",
  "Review",
  "Optimize",
  "Document",
  "Rename",
  "Extract",
  "Wire up",
  "Stabilize",
]

const objects = [
  "flaky retry in the session runner",
  "memory growth in the Home index",
  "i18n keys for the settings dialog",
  "the review pane remount on tab switch",
  "SQLite migration for session inbox",
  "OAuth callback handling",
  "terminal scrollback serialization",
  "Playwright visual stability probes",
  "the composer paste path",
  "provider catalog normalization",
  "the worktree preparation flow",
  "CI cache keys for bun install",
  "Markdown highlighting for large fences",
  "the permission auto-approver",
  "cursor pagination for /api/session",
  "the desktop titlebar on Windows",
  "the file tree lazy loading",
  "event replay ordering",
  "RTL layout in the sidebar",
  "unread badges for background sessions",
]

const contexts = [
  "",
  "",
  "",
  " (#{n})",
  " in packages/app",
  " in packages/core",
  " for v2",
  " before release",
  " — follow-up",
  " · src/{file}.ts",
  " after the Electron upgrade",
  " with tests",
]

const files = ["controller", "index", "records", "store", "runtime", "layout", "timeline", "composer", "data", "sync"]

const agents = ["build", "build", "build", "build", "plan", "general"]

const models = [
  { id: "claude-opus-4-6", providerID: "anthropic", variant: "default" },
  { id: "claude-sonnet-4-6", providerID: "anthropic", variant: "default" },
  { id: "gpt-5.3-codex", providerID: "openai", variant: "high" },
  { id: "gemini-3-pro", providerID: "google", variant: "default" },
]

const DAY = 24 * 60 * 60 * 1000

export function createHomeIndexFixture(input: { count: number; now: number; directories?: number }) {
  const random = mulberry32(0x5eed_0000 + input.count)
  const directoryCount = Math.min(input.directories ?? 12, repos.length)
  const directories: HomeIndexDirectory[] = repos.slice(0, directoryCount).map((name, index) => ({
    directory: `/Users/dev/repos/${name}`,
    name,
    projectID: `prj_${hex(random, 16)}`,
    project: index < Math.max(1, Math.round(directoryCount * 0.66)),
  }))
  // Zipf-like spread: a few repositories hold most of the history.
  const weights = directories.map((_, index) => 1 / Math.pow(index + 1, 0.9))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const cumulative = weights.map((_, index) => weights.slice(0, index + 1).reduce((sum, w) => sum + w, 0) / total)

  // Newest first; adding the index after sorting keeps offsets strictly
  // increasing so no two sessions share an updated time.
  const offsets = Array.from({ length: input.count }, () => {
    const bucket = random()
    // 5% today, 5% yesterday, the rest skewed toward recent months over 18 months.
    if (bucket < 0.05) return Math.floor(random() * DAY * 0.9)
    if (bucket < 0.1) return DAY + Math.floor(random() * DAY * 0.9)
    return 2 * DAY + Math.floor(Math.pow(random(), 2) * 538 * DAY)
  })
    .sort((a, b) => a - b)
    .map((offset, index) => offset + index)

  const newestFirst: HomeIndexSession[] = offsets.map((offset, index) => {
    const pick = random()
    const directory = directories[cumulative.findIndex((edge) => pick <= edge)] ?? directories[0]
    const updated = input.now - offset
    const duration = 5 * 60_000 + Math.floor(random() * 6 * 60 * 60_000)
    const tokens = {
      input: 5_000 + Math.floor(random() * 400_000),
      output: 500 + Math.floor(random() * 60_000),
      reasoning: random() < 0.6 ? Math.floor(random() * 20_000) : 0,
      cache: { read: Math.floor(random() * 900_000), write: Math.floor(random() * 120_000) },
    }
    const outcome = random() < 0.9 ? "succeeded" : random() < 0.6 ? "failed" : "interrupted"
    return {
      id: `ses_${base62(random, 26)}`,
      projectID: directory.projectID,
      ...(random() < 0.97 ? { title: title(random, index) } : {}),
      agent: agents[Math.floor(random() * agents.length)],
      model: models[Math.floor(random() * models.length)],
      // USD at $3/M input, $15/M output, $0.30/M cache read, $3.75/M cache write.
      cost:
        Math.round(
          (tokens.input * 3 + tokens.output * 15 + tokens.cache.read * 0.3 + tokens.cache.write * 3.75) / 100,
        ) / 10_000,
      tokens,
      outcome,
      time: {
        created: updated - duration,
        updated,
        idle: updated - Math.floor(random() * 2_000),
        ...(random() < 0.8 ? { viewed: updated } : {}),
      },
      location: { directory: directory.directory },
    }
  })
  // The mock lists sessions in array order and reverses for `desc`, so keep
  // the fixture ascending by updated time like the server's index order.
  const sessions = newestFirst.toReversed()
  const newest = newestFirst[0]
  const encoded = JSON.stringify({ data: sessions.map((session) => currentSession(session)), cursor: {} })

  return {
    version: HOME_INDEX_FIXTURE_VERSION,
    count: input.count,
    now: input.now,
    directories,
    sessions,
    // Bytes the mock serves for the complete index when it fits one page.
    listBytes: Buffer.byteLength(encoded),
    expected: {
      visible: Math.min(HOME_INDEX_VISIBLE_LIMIT, input.count),
      newestID: newest.id,
      // The mock labels untitled sessions with their ID.
      newestTitle: newest.title ?? newest.id,
      perDirectory: Object.fromEntries(
        [...Map.groupBy(sessions, (session) => session.location.directory)].map(([directory, items]) => [
          directory,
          items.length,
        ]),
      ),
    },
  }
}

export type HomeIndexFixture = ReturnType<typeof createHomeIndexFixture>

function title(random: () => number, index: number) {
  const verb = verbs[Math.floor(random() * verbs.length)]
  const object = objects[Math.floor(random() * objects.length)]
  const context = contexts[Math.floor(random() * contexts.length)]
    .replace("{n}", String(1000 + Math.floor(random() * 45_000)))
    .replace("{file}", files[Math.floor(random() * files.length)])
  // Keep titles unique so row identity checks cannot match a sibling.
  return `${verb} ${object}${context} [${index.toString(36)}]`
}

function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

function base62(random: () => number, length: number) {
  return Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join("")
}

function hex(random: () => number, length: number) {
  return Array.from({ length }, () => Math.floor(random() * 16).toString(16)).join("")
}
