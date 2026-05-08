type Key = {
  providerID: string
  modelID: string
}

type Item = {
  id: string
  provider: {
    id: string
  }
  variants?: Record<string, unknown>
}

type PickInput = {
  list: Item[]
  used: Key
  review?: Key
  base?: Key
  now?: Key
  exclude?: Key[]
}

type PickOutput = {
  model: Key
  variant?: string
}

export type ReviewKind = "supervisor" | "cross-review"

const heads: Record<ReviewKind, string> = {
  supervisor: "Codex, run supervisor review",
  "cross-review": "Codex, run cross-review",
}
const legacy = "Codex, run auto-review"
const done = "Task completed."

const key = (item: Key) => `${item.providerID}/${item.modelID}`

const same = (a: Key, b: Key) => a.providerID === b.providerID && a.modelID === b.modelID

const asKey = (item: Item): Key => ({
  providerID: item.provider.id,
  modelID: item.id,
})

const find = (list: Item[], item: Key | undefined) => {
  if (!item) return
  return list.find((x) => x.provider.id === item.providerID && x.id === item.modelID)
}

export const reviewPrompt = (prev: string) =>
  reviewPromptFor(prev, "supervisor")

export const reviewPromptFor = (prev: string, kind: ReviewKind) => {
  if (kind === "cross-review") {
    return [
      `${heads[kind]} for supervisor output on ${prev} work.`,
      "Independently validate the supervisor review for accuracy and completeness.",
      "Re-check playbook compliance, issue tracker state, PR status, local test runs, end-to-end coverage, and CI status.",
      "If anything is still missing, provide concrete next actions and continue the same phase.",
      `If and only if everything is done, print exactly: "${done}"`,
    ].join("\n")
  }

  return [
    `${heads[kind]} for ${prev} work.`,
    "Run explicit supervisor checks:",
    "1/ Verify task completion against the requested scope.",
    "2/ If ./.agents/review.md exists, verify it was followed. If not, verify issue tracker state (GitHub/Linear/Jira) is up to date.",
    "3/ Ensure a PR exists when applicable, and merge status is correct when done.",
    "4/ Ensure local tests were run.",
    "5/ Ensure tests cover touched functionality end-to-end.",
    "6/ Ensure CI workflows passed.",
    "7/ If gaps remain, provide concrete next actions and continue.",
    `8/ If and only if everything is done, print exactly: "${done}"`,
  ].join("\n")
}

export const reviewPromptKind = (text: string): ReviewKind | undefined => {
  const line = text.toLowerCase()
  if (line.startsWith(heads.supervisor.toLowerCase())) return "supervisor"
  if (line.startsWith(heads["cross-review"].toLowerCase())) return "cross-review"
  if (line.startsWith(legacy.toLowerCase())) return "supervisor"
}

export const reviewPromptCheck = (text: string) => !!reviewPromptKind(text)

export const reviewDone = (text: string) => text.trim() === done

export const reviewPick = (input: PickInput): PickOutput | undefined => {
  const map = new Map<string, Item>()

  const add = (item: Key | undefined) => {
    const hit = find(input.list, item)
    if (!hit) return
    map.set(key(asKey(hit)), hit)
  }

  add(input.review)
  add(input.base)
  add(input.now)

  for (const item of input.list) {
    map.set(key(asKey(item)), item)
  }

  const list = [...map.values()]
  if (list.length === 0) return

  const avoid = input.exclude ?? []
  const open = list.filter((item) => !same(asKey(item), input.used))
  const safe = open.filter((item) => avoid.every((x) => !same(asKey(item), x)))
  const pick = safe[0] ?? (avoid.length === 0 ? open[0] : undefined)
  if (!pick) return

  return {
    model: asKey(pick),
    variant: pick.variants && Object.hasOwn(pick.variants, "xhigh") ? "xhigh" : undefined,
  }
}
