import type { UiI18n } from "@opencode/ui/context/i18n"
import { getFilename } from "@opencode/util/path"
import { factsOf, summarize, type FactMode, type FactPart } from "../../timeline/facts"
import { launchKeys, verbKeys, workKey } from "../events"
import type { ActivityGroupPart } from "./context-group"

// The most consequential work names a group: changing files over running commands, and both over reading.
const modePriority: FactMode[] = ["edit", "run", "tool", "explore"]

const modeVerb = {
  explore: "ui.timeline.activity.explored",
  edit: "ui.timeline.activity.edited",
  run: "ui.timeline.activity.ran",
  tool: "ui.timeline.activity.used",
} as const

/**
 * A group's parts as facts. What background work reported counts as its outcome; notices count nothing. A script's
 * files count where they are placed, so only those in the group.
 */
export function activityFacts(parts: readonly ActivityGroupPart[]) {
  const facts = factsOf(
    parts.flatMap((part, index): FactPart[] => {
      // Thoughts one after another count as one, as they show.
      if (part.type === "reasoning") return parts[index - 1]?.type === "reasoning" ? [] : [part]

      if (part.type === "tool") return [part]

      if (part.type !== "event") return []
      const { kind, verb, failed } = part.event

      return [{ type: "outcome", id: part.id, outcome: { kind, verb, failed, key: workKey(part.event) } }]
    }),
  )

  return [
    ...facts.filter((fact) => fact.kind !== "file" || fact.via !== "script"),
    ...parts.flatMap((part) => (part.type === "file" ? [part.file] : [])),
  ]
}

/**
 * Names a stretch of the agent's work by its main mode, then what its other calls did: "Edited 4 files · 2 commands,
 * started 1 shell". A background shell is counted once by its outcome.
 */
export function activityLabel(parts: readonly ActivityGroupPart[], i18n: UiI18n) {
  const summary = summarize(activityFacts(parts))
  const launches = summary.background.verbs
  const launched = launches.map((bucket) => i18n.plural(launchKeys[bucket.verb], bucket.count))
  // Files a script changed name the group as edits do, where they are placed in it.
  const mode = modePriority.find((item) => summary.modes[item] > 0 || (item === "edit" && summary.files.length > 0))

  if (!mode) {
    const [first, ...rest] = launches

    if (!first) return

    return {
      verb: i18n.t(verbKeys[first.verb]),
      main: i18n.plural("ui.timeline.event.shells", first.count),
      others: rest.map((bucket) => i18n.plural(launchKeys[bucket.verb], bucket.count)),
    }
  }

  const files = summary.files

  // Reads count as files where exploring names the group, and as reads beside other work.
  const explore = (main: boolean) =>
    [
      [main ? "ui.timeline.activity.files" : "ui.timeline.activity.reads", summary.reads] as const,
      ["ui.timeline.activity.searches", summary.searches] as const,
      ["ui.timeline.activity.webSearches", summary.webSearches] as const,
      ["ui.timeline.activity.pages", summary.pages] as const,
      ["ui.timeline.activity.skills", summary.skills] as const,
    ].flatMap(([key, value]) => (value > 0 ? [i18n.plural(key, value)] : []))

  // Commands are counted, never quoted: a command can be any length.
  const commands = summary.commands ? [i18n.plural("ui.timeline.activity.commands", summary.commands)] : []
  const used = [...new Set(summary.tools.map((name) => toolTitle(name, i18n)))]

  const others = {
    explore: explore(false),
    edit: files.length ? [i18n.plural("ui.timeline.activity.editedFiles", files.length)] : [],
    run: commands,
    tool: used,
  }

  const main = {
    // A few files read better by name; past that, the count says more than a list that truncates.
    edit:
      files.length <= 2
        ? files.map((path) => getFilename(path)).join(", ")
        : i18n.plural("ui.timeline.activity.files", files.length),
    run: commands[0]!,
    tool: used.join(", "),
    explore: explore(true).join(", "),
  }[mode]

  return {
    verb: i18n.t(modeVerb[mode]),
    main,
    others: [...modePriority.filter((item) => item !== mode).flatMap((item) => others[item]), ...launched],
  }
}

/** An activity label as one line of text, where there is one. */
export function activityText(value: ReturnType<typeof activityLabel>) {
  if (!value) return

  return {
    text: [[value.verb, value.main].filter(Boolean).join(" "), value.others.join(", ")].filter(Boolean).join(" · "),
  }
}

/** What a group without activity used: its thoughts, or updates. */
export function usedLabel(parts: readonly ActivityGroupPart[], i18n: UiI18n) {
  const count = summarize(activityFacts(parts)).thoughts

  if (!count) {
    const text = i18n.t("ui.messagePart.context.updates")

    return { text, title: "", before: text, count: undefined, between: "", after: "" }
  }

  const title = i18n.plural("ui.messagePart.context.thought", count)
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

// What a call is named in a group's label.
function toolTitle(name: string, i18n: UiI18n) {
  const key = {
    read: "ui.tool.read",
    list: "ui.tool.list",
    glob: "ui.tool.glob",
    grep: "ui.tool.grep",
    browser: "ui.tool.browser",
    webfetch: "ui.tool.fetch",
    websearch: "ui.tool.searchWeb",
    subagent: "ui.tool.agent.default",
    shell: "ui.tool.shell",
    execute: "ui.tool.execute",
    edit: "ui.messagePart.title.edit",
    write: "ui.messagePart.title.write",
    patch: "ui.tool.patch",
    question: "ui.tool.questions",
    skill: "ui.tool.skill",
  }[name]

  return key ? i18n.t(key) : name
}
