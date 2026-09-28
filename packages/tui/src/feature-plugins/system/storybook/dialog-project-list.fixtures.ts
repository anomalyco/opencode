import type { Project, SessionInfo } from "@opencode/client"

export type ProjectListScope = "all" | "project" | "cwd"

export const PROJECT_LIST_SCOPES: readonly { id: ProjectListScope; label: string }[] = [
  { id: "all", label: "all projects" },
  { id: "project", label: "current project" },
  { id: "cwd", label: "current directory" },
]

const now = Date.now()
const hour = 3_600_000
const day = 24 * hour

function session(
  id: string,
  title: string,
  directory: string,
  projectID: string,
  updatedAgo: number,
  subpath?: string,
): SessionInfo {
  return {
    id,
    projectID,
    title,
    subpath,
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: now - updatedAgo - hour, updated: now - updatedAgo },
  } as unknown as SessionInfo
}

function project(id: string, canonical: string, name: string, vcs = "git"): Project {
  return {
    id,
    canonical,
    name,
    vcs,
    time: { created: now - 30 * day, updated: now - day, active: now - hour },
    sandboxes: [],
  } as Project
}

export const PROJECT_LIST_PROJECTS = [
  project("proj-opencode", "/home/kit/code/opencode", "opencode"),
  project("proj-docs", "/home/kit/code/opencode-docs", "opencode-docs"),
  // DB-only: known to project.list, has no sessions in the recents below.
  project("proj-db-only", "/home/kit/code/opencode-db-only", "opencode-db-only"),
] as const

// 10 recents: exceeds the production RECENT_LIMIT of 8 so the story exercises truncation.
export const PROJECT_LIST_RECENTS: SessionInfo[] = [
  session("ses_00000000000000000000000001", "Implement session tabs", "/home/kit/code/opencode", "proj-opencode", 2 * 60_000),
  session("ses_00000000000000000000000002", "Investigate rendering", "/home/kit/code/opencode", "proj-opencode", 18 * 60_000),
  session("ses_00000000000000000000000003", "Fix provider state", "/home/kit/code/opencode", "proj-opencode", 3 * hour),
  session("ses_00000000000000000000000004", "Review animation", "/home/kit/code/opencode-docs", "proj-docs", 5 * hour),
  session("ses_00000000000000000000000005", "Queue follow-up work", "/home/kit/code/opencode", "proj-opencode", 9 * hour),
  session("ses_00000000000000000000000006", "Check narrow layout", "/home/kit/code/opencode-docs", "proj-docs", 26 * hour),
  // Deleted fixture: production drops this row when session.deleted arrives in flight.
  session("ses_00000000000000000000000007", "Stale spike to delete", "/home/kit/code/opencode", "proj-opencode", 30 * hour),
  // Moved fixture: production rewrites location via moveOpenSession on session.moved.
  session(
    "ses_00000000000000000000000008",
    "Worktree checkout",
    "/home/kit/code/opencode",
    "proj-opencode",
    32 * hour,
    "packages/tui",
  ),
  session("ses_00000000000000000000000009", "Profile terminal output", "/home/kit/code/opencode", "proj-opencode", 3 * day),
  session("ses_00000000000000000000000010", "Prepare review", "/home/kit/code/opencode-docs", "proj-docs", 5 * day),
]

export const PROJECT_LIST_DELETED_ID = "ses_00000000000000000000000007"
export const PROJECT_LIST_MOVED_ID = "ses_00000000000000000000000008"
export const PROJECT_LIST_MOVED_DESTINATION = {
  directory: "/home/kit/code/opencode-worktree",
  projectID: "proj-opencode",
  subpath: undefined,
}

// Windows / POSIX alias pair: same project visible through two spellings.
export const PROJECT_LIST_ALIAS_PAIR = {
  windows: "E:/work/opencode",
  posix: "/mnt/e/work/opencode",
  projectID: "proj-opencode",
} as const

// Query error forces the local fallback path (mirrors dialog-open/session-list catch blocks).
export const PROJECT_LIST_FALLBACK_DIRECTORIES = ["/home/kit/code/opencode", "/home/kit/code/opencode-docs"]
export const PROJECT_LIST_QUERY_ERROR = "query failed: transport unavailable (fixture)"
