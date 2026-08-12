import path from "path"

export const JD_STUB = `# <role title>

- Team: <team or TBD>
- Level: TBD
- Location: TBD

## Must-haves
- TBD

## Nice-to-haves
- TBD
`

export const SCORECARD_STUB = `# Scorecard — <role title>

| Dimension | Bar | Notes |
|-----------|-----|-------|
| TBD | 1–5 | |
`

export const NOTES_STUB = `# Process notes

- Owners: TBD
- Open questions:
  - TBD
`

const REQ_FILES = [
  [".moks/req/jd.md", JD_STUB],
  [".moks/req/scorecard.md", SCORECARD_STUB],
  [".moks/req/notes.md", NOTES_STUB],
] as const

const GITKEEP = ".moks/req/scores/.gitkeep"

export async function scaffold(worktree: string) {
  const created: string[] = []
  const skipped: string[] = []

  for (const [rel, content] of REQ_FILES) {
    const file = Bun.file(path.join(worktree, rel))
    if ((await file.exists()) && (await file.text()).trim().length > 0) {
      skipped.push(rel)
      continue
    }
    await Bun.write(path.join(worktree, rel), content)
    created.push(rel)
  }

  const gitkeep = Bun.file(path.join(worktree, GITKEEP))
  if (await gitkeep.exists()) {
    skipped.push(GITKEEP)
  } else {
    await Bun.write(path.join(worktree, GITKEEP), "")
    created.push(GITKEEP)
  }

  const gitignore = path.join(worktree, ".gitignore")
  const ignore = Bun.file(gitignore)
  if (await ignore.exists()) {
    const text = await ignore.text()
    if (hasMoksIgnore(text)) {
      skipped.push(".gitignore")
    } else {
      const prefix = text.length === 0 || text.endsWith("\n") ? text : `${text}\n`
      await Bun.write(gitignore, `${prefix}.moks/\n`)
      created.push(".gitignore")
    }
  }

  return { created, skipped }
}

function hasMoksIgnore(text: string) {
  return text.split(/\r?\n/).some((line) => {
    const trimmed = line.trim()
    return trimmed === ".moks" || trimmed === ".moks/" || trimmed === "/.moks" || trimmed === "/.moks/"
  })
}

export * as ReqWorkspace from "./req-workspace"
