export type HermesRow = {
  id: string
  tools: string[]
  extra: number
}

export type HermesMeta = {
  version?: string
  upstream?: string
  total: number
  rows: HermesRow[]
}

const groups = [
  { id: "browser", tools: ["browser_back", "browser_click", "browser_console", "browser_get_images", "browser_navigate", "browser_press", "browser_scroll", "browser_snapshot", "browser_type", "browser_vision"] },
  { id: "browser-cdp", tools: ["browser_cdp", "browser_dialog"] },
  { id: "clarify", tools: ["clarify"] },
  { id: "code_execution", tools: ["execute_code"] },
  { id: "cronjob", tools: ["cronjob"] },
  { id: "delegation", tools: ["delegate_task"] },
  { id: "file", tools: ["patch", "read_file", "search_files", "write_file"] },
  { id: "memory", tools: ["memory", "session_search"] },
  { id: "skills", tools: ["skill_manage", "skill_view", "skills_list"] },
  { id: "terminal", tools: ["process", "terminal"] },
  { id: "web", tools: ["web_extract", "web_search"] },
] as const

type Probe = {
  version?: string
  upstream?: string
  tools?: unknown
}

const script = (dir: string) => `
import json, pathlib, subprocess, tomllib
from toolsets import resolve_toolset

root = pathlib.Path(${JSON.stringify(dir)})
ver = None
head = None

try:
    with open(root / "pyproject.toml", "rb") as fh:
        ver = tomllib.load(fh).get("project", {}).get("version")
except Exception:
    ver = None

try:
    hit = subprocess.run(
        ["git", "rev-parse", "--short=8", "HEAD"],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
        timeout=5,
    )
    if hit.returncode == 0:
        head = hit.stdout.strip() or None
except Exception:
    head = None

tools = resolve_toolset("hermes-cli")
print(json.dumps({"version": ver, "upstream": head, "tools": tools}))
`

export function buildHermesMeta(input: { version?: string; upstream?: string; tools?: string[] }) {
  const set = new Set((input.tools ?? []).filter(Boolean))
  const rows: HermesRow[] = []

  for (const group of groups) {
    const tools = group.tools.filter((tool) => set.has(tool))
    if (tools.length === 0) continue
    const show = tools.slice(0, 4)
    rows.push({
      id: group.id,
      tools: show,
      extra: tools.length - show.length,
    })
  }

  return {
    version: input.version,
    upstream: input.upstream,
    total: set.size,
    rows,
  } satisfies HermesMeta
}

export async function probeHermesMeta(input: { python: string; dir: string }) {
  const proc = Bun.spawn([input.python, "-c", script(input.dir)], {
    cwd: input.dir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  const [code, out, err] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (code !== 0) {
    throw new Error(err.trim() || `Hermes metadata probe failed with code ${code}`)
  }

  const raw = JSON.parse(out) as Probe
  const tools = Array.isArray(raw.tools) ? raw.tools.filter((item): item is string => typeof item === "string") : []
  return buildHermesMeta({
    version: typeof raw.version === "string" ? raw.version : undefined,
    upstream: typeof raw.upstream === "string" ? raw.upstream : undefined,
    tools,
  })
}
