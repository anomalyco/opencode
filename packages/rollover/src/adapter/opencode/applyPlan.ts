/** Apply a ViewPlan to a raw message list (spec Part A §8.4). Pure: returns a new array. */
export interface ApplyPlanOpts {
  sessionID: string
}

export function applyPlan(raw: unknown[], plan: { items: Array<{ srcIndex: number; textOnly: boolean }>; prependText: string }, opts: ApplyPlanOpts): unknown[] {
  const next: unknown[] = []
  for (let i = 0; i < plan.items.length; i++) {
    const item = plan.items[i]
    const src = raw[item.srcIndex]
    if (src === undefined) continue
    const clone = structuredClone(src) as { content?: unknown[] }
    let content = Array.isArray(clone.content) ? [...clone.content] : []
    if (item.textOnly) {
      content = content.filter((p: unknown) => (p as { type?: string })?.type === "text")
    }
    if (i === 0) {
      content = [{ type: "text", text: plan.prependText }, ...content]
    }
    clone.content = content
    next.push(clone)
  }
  return next
}
