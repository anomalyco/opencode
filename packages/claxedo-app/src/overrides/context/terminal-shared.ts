export type LocalPTY = {
  id: string
  title: string
  titleNumber: number
  cwd?: string
  rows?: number
  cols?: number
  buffer?: string
  scrollY?: number
  cursor?: number
  initialCommand?: string
}

function titleNum(title: string) {
  const m = title.match(/^Terminal (\d+)$/)
  if (!m) return
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return
  return n
}

function nextNum(all: LocalPTY[]) {
  const nums = new Set(
    all.flatMap((pty) => {
      const direct = Number.isFinite(pty.titleNumber) && pty.titleNumber > 0 ? pty.titleNumber : undefined
      if (direct !== undefined) return [direct]
      const parsed = titleNum(pty.title)
      if (parsed === undefined) return []
      return [parsed]
    }),
  )
  return Array.from({ length: nums.size + 1 }, (_, i) => i + 1).find((n) => !nums.has(n)) ?? 1
}

export function mergeCreatedTerminal(
  all: LocalPTY[],
  info: { id: string; title?: string; cwd?: string },
) {
  const existing = all.find((pty) => pty.id === info.id)
  if (existing) return all
  const parsed = info.title ? titleNum(info.title) : undefined
  const titleNumber = parsed ?? nextNum(all)
  const title = info.title ?? `Terminal ${titleNumber}`
  return [...all, { id: info.id, title, titleNumber, cwd: info.cwd }]
}

