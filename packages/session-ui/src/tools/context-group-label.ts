import type { UiI18n } from "@opencode/ui/context/i18n"
import { factsOf, summarize, type FactPart, type Summary } from "../timeline/facts"
import type { ContextGroupPart } from "./tool-renderer"

const webSearchProviderNames = new Map([
  ["tinyfish", "TinyFish"],
  ["opencode", "OpenCode"],
])

export function webSearchProviderLabel(provider: string | undefined, i18n: UiI18n) {
  if (!provider) return i18n.t("ui.tool.websearch")
  const name = webSearchProviderNames.get(provider) ?? `${provider[0].toUpperCase()}${provider.slice(1)}`

  return i18n.t("ui.tool.websearch.provider", { provider: name })
}

// Context group labels name each tool once; detailed subtitles belong to the tool rows.
function toolTitle(tool: Summary["toolNames"][number], i18n: UiI18n) {
  switch (tool.tool) {
    case "read":
      return i18n.t("ui.tool.read")
    case "read_terminal":
      return i18n.t("ui.tool.readTerminal")
    case "list":
      return i18n.t("ui.tool.list")
    case "glob":
      return i18n.t("ui.tool.glob")
    case "grep":
      return i18n.t("ui.tool.grep")
    case "browser":
      return i18n.t("ui.tool.browser")
    case "webfetch":
      return i18n.t("ui.tool.webfetch")
    case "websearch":
      return webSearchProviderLabel(tool.provider, i18n)
    case "subagent":
      return i18n.t("ui.tool.agent.default")
    case "shell":
      return i18n.t("ui.tool.shell")
    case "execute":
      return i18n.t("ui.tool.execute")
    case "edit":
      return i18n.t("ui.messagePart.title.edit")
    case "write":
      return i18n.t("ui.messagePart.title.write")
    case "patch":
      return i18n.t("ui.tool.patch")
    case "question":
      return i18n.t("ui.tool.questions")
    case "skill":
      return i18n.t("ui.tool.skill")
    default:
      return tool.tool
  }
}

/**
 * A context group's parts as facts. A user's shell command counts as a call; notices and text count nothing. A script's
 * files count where they are placed, so only those in the group.
 */
export function contextGroupFacts(parts: readonly ContextGroupPart[]) {
  return parts.flatMap((part) => {
    if (part.type === "file") return [part.file]

    const own: FactPart[] =
      part.type === "tool" || part.type === "reasoning"
        ? [part]
        : part.type === "shell"
          ? [{ type: "shell", id: part.id }]
          : []

    return factsOf(own).filter((fact) => fact.kind !== "file" || fact.via !== "script")
  })
}

/** The closed label of a group of calls and thoughts: "Used 3 Read, Grep". */
export function contextGroupLabel(parts: readonly ContextGroupPart[], i18n: UiI18n) {
  const facts = contextGroupFacts(parts)
  const summary = summarize(facts)
  const thoughts = summary.thoughts
  // Rows pass calls by their part id and a script's changes by message and part id, so a change names its script by either.
  const calls = new Set(facts.flatMap((fact) => (fact.kind === "call" ? [fact.id] : [])))
  const shown = (by: string) => calls.has(by) || calls.has(by.slice(by.indexOf(":") + 1))

  // A hidden script's changes read as the patch a direct edit shows as, one call per script, in the order they came.
  const scripts = new Set(
    facts.flatMap((fact) => (fact.kind === "file" && fact.via === "script" && !shown(fact.by) ? [fact.by] : [])),
  )

  const names = i18n.list([
    ...new Set(
      facts.flatMap((fact) => {
        if (fact.kind === "call") return [toolTitle({ tool: fact.tool, provider: fact.provider }, i18n)]

        return fact.kind === "file" && scripts.has(fact.by) ? [toolTitle({ tool: "patch" }, i18n)] : []
      }),
    ),
  ])

  if (!names && !thoughts) {
    const text = i18n.t("ui.messagePart.context.updates")

    return { text, title: "", before: text, count: undefined, between: "", after: "" }
  }

  const title = names || i18n.plural("ui.messagePart.context.thought", thoughts)
  const count = summary.calls + scripts.size || thoughts
  const text = i18n.plural("ui.messagePart.tools.used", count, { tools: title })
  const index = text.indexOf(title)
  const before = text.slice(0, index).trim()
  const countText = String(count)
  const countIndex = before.indexOf(countText)
  const after = text.slice(index + title.length).trim()

  if (countIndex === -1) return { text, title, before, count: undefined, between: "", after }

  return {
    text,
    title,
    before: before.slice(0, countIndex).trim(),
    count,
    between: before.slice(countIndex + countText.length).trim(),
    after,
  }
}
