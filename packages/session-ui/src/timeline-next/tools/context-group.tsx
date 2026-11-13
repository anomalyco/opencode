import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import { AnimatedNumber } from "@opencode/ui/animated-number"
import { Badge } from "@opencode/ui/badge"
import { type UiI18n, useI18n } from "@opencode/ui/context/i18n"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { getFilename } from "@opencode/util/path"
import { Option, Schema } from "effect"
import { createMemo, For, Index, Match, Show, Switch } from "solid-js"
import { BasicTool } from "../../components/basic-tool"
import {
  currentToolError,
  currentToolGroupedRead,
  currentToolInput,
  currentToolMetadata,
  currentToolOutput,
} from "../../message/current-tool-state"
import { AssistantReasoningContent } from "../../message/message-content"
import {
  CurrentReadToolGroup,
  currentSkillName,
  displayDirectory,
  scrollParent,
  toolInput,
  toolMetadata,
  type ContextGroupPart,
} from "../../tools/tool-renderer"
import { TimelineEventRow } from "../event-row"
import { kindKeys, launchKeys, summarizeEvents, toolEvent, verbKeys, workKey, type TimelineEvent } from "../events"
import { toolRule, toolStopped, type ToolMode } from "../rules"
import { FileGroup } from "./file-group"
import { ThoughtRow } from "./thought"
import { ToolDisplay } from "./tool-display"

/** A part of an activity group: a call, a thought, a notice, or background work reporting back. */
export type ActivityGroupPart = ContextGroupPart | { type: "event"; id: string; event: TimelineEvent }

// Subagents and background work listed one after another in an opened group, as one nested events row.
type WorkRun = { type: "work"; id: string; events: TimelineEvent[] }

/**
 * A stretch of the agent's work folded into one row, named by what it did: "Explored 3 files · 2 commands". It only
 * records what happened; the status line below the turn says what is live. A stretch of thoughts alone is those
 * thoughts, without a group around them.
 */
export function ContextGroup(props: {
  parts: ActivityGroupPart[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSizeChange?: () => void
  reasoningDefaultOpen?: boolean
  reasoningOpen?: (id: string) => boolean | undefined
  onReasoningOpenChange?: (id: string, open: boolean) => void
  toolDefaultOpen?: (tool: SessionMessageAssistantTool) => boolean | undefined
  toolOpen?: (id: string) => boolean | undefined
  onToolOpenChange?: (id: string, open: boolean) => void
  fileOpen?: (path: string) => boolean | undefined
  onFileOpenChange?: (path: string, open: boolean) => void
  patchGroupKey?: (tools: SessionMessageAssistantTool[]) => string
  onRevealShell?: (shellID: string) => void
}) {
  const i18n = useI18n()
  const tools = createMemo(() => props.parts.filter((part) => part.type === "tool"))
  const reasoning = createMemo(() => props.parts.flatMap((part) => (part.type === "reasoning" ? [part] : [])))
  const thoughtsOnly = createMemo(() => reasoning().length > 0 && reasoning().length === props.parts.length)
  const events = createMemo(() => [...workEvents(props.parts).values()])

  // A group of only subagents and work reporting back reads as the events row it is, not a group around one. Until a
  // call has anything to count, it stays a group, so the row never renders empty.
  const workOnly = createMemo(
    () =>
      events().length > 0 &&
      props.parts.every((part) => part.type === "event" || (part.type === "tool" && toolRule(part).name === "subagent")),
  )

  const activity = createMemo(() => activityLabel(tools(), events(), i18n))

  const label = createMemo(() => {
    const value = activity()

    if (value)
      return {
        text: [[value.verb, value.main].filter(Boolean).join(" "), value.others.join(", ")].filter(Boolean).join(" · "),
      }

    return usedLabel(props.parts, i18n)
  })

  const items = createMemo(() =>
    (props.open ? props.parts : []).reduce<
      (
        | SessionMessageAssistantTool[]
        | Exclude<ActivityGroupPart, SessionMessageAssistantTool | { type: "event" }>
        | WorkRun
      )[]
    >((groups, tool) => {
      const previous = groups.at(-1)

      // Subagents started one after another, and work reporting back, read as one events row nested in the group:
      // "Started 3 subagents". The rows keep the order things happened in, which the label does not.
      if (tool.type === "event" || (tool.type === "tool" && toolRule(tool).name === "subagent")) {
        // A subagent still being asked for has nothing to list yet.
        const event = tool.type === "event" ? tool.event : toolEvent(tool)

        if (!event) return groups
        const run = previous && !Array.isArray(previous) && previous.type === "work" ? previous : undefined
        const key = tool.type === "event" ? workKey(event) : undefined

        // Work reporting back right after its launch, with nothing between, finishes the launch's row. With
        // anything between, the launch and the report each keep their row.
        const launch = key && run ? run.events.findIndex((item) => item.verb === "started" && workKey(item) === key) : -1

        if (run && launch >= 0) {
          run.events[launch] = { ...run.events[launch]!, verb: event.verb, failed: event.failed }

          return groups
        }

        if (run) {
          run.events.push(event)

          return groups
        }

        groups.push({ type: "work", id: tool.id, events: [event] })

        return groups
      }

      if (tool.type !== "tool") {
        groups.push(tool)

        return groups
      }

      if (Array.isArray(previous) && previous[0] && joins(previous[0], tool)) {
        previous.push(tool)

        return groups
      }

      groups.push([tool])

      return groups
    }, []),
  )

  const patchKeys = createMemo(() => {
    const keys = new Map<SessionMessageAssistantTool, string>()
    items().forEach((item) => {
      if (!Array.isArray(item) || !item[0] || !changesFiles(item[0])) return
      const key = props.patchGroupKey?.(item) ?? item[0].id
      item.forEach((tool) => keys.set(tool, key))
    })

    return keys
  })

  let root: HTMLDivElement | undefined

  const change = (open: boolean) => {
    // Collapsing from the stuck header would leave the viewport far below the group, so keep the header in place.
    // Scroll before collapsing because the shorter content would clamp the scroll position first.
    const trigger = root?.querySelector(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
    const stuck = !open && root && trigger ? trigger.getBoundingClientRect().top - root.getBoundingClientRect().top : 0

    if (stuck > 0 && root) scrollParent(root)?.scrollBy({ top: -stuck, behavior: "instant" })
    props.onOpenChange(open)
    props.onSizeChange?.()
  }

  return (
    <Show
      when={!thoughtsOnly()}
      fallback={
        <div data-component="thought-rows" data-timeline-part-ids={props.parts.map((part) => part.id).join(",")}>
          <For each={reasoning()}>
            {(part) => (
              <ThoughtRow
                id={part.id}
                content={part}
                streaming={part.streaming ?? false}
                defaultOpen={props.reasoningDefaultOpen}
                open={props.reasoningOpen?.(part.id)}
                onOpenChange={(open) => props.onReasoningOpenChange?.(part.id, open)}
                onContentRendered={props.onSizeChange}
              />
            )}
          </For>
        </div>
      }
    >
      <Show
        when={!workOnly()}
        fallback={
          <div data-timeline-part-ids={props.parts.map((part) => part.id).join(",")}>
            <TimelineEventRow
              events={events()}
              open={props.open}
              onOpenChange={change}
              onRevealShell={props.onRevealShell}
            />
          </div>
        }
      >
        <div
          ref={root}
          data-component="collapsed-tool-group"
          data-timeline-part-ids={props.parts.map((part) => part.id).join(",")}
        >
          <BasicTool
            icon="glasses"
            status="completed"
            compact
            hasContent
            allowOpenWhilePending
            open={props.open}
            onOpenChange={change}
            trigger={
              <div data-component="context-tool-group-trigger" aria-label={label().text}>
                <Show when={activity()} fallback={<UsedTitle label={usedLabel(props.parts, i18n)} />}>
                  {(value) => (
                    <span data-slot="context-tool-group-title" data-activity="">
                      <span data-slot="context-tool-group-verb">{value().verb}</span>
                      <Show when={value().main}>
                        <span data-slot="context-tool-group-detail">{value().main}</span>
                      </Show>
                      <Show when={value().others.length > 0}>
                        <span data-slot="context-tool-group-separator" aria-hidden="true">
                          ·
                        </span>
                        <span data-slot="context-tool-group-detail">{value().others.join(", ")}</span>
                      </Show>
                    </span>
                  )}
                </Show>
              </div>
            }
          >
            <div data-component="context-tool-group-list">
              <Index each={items()}>
                {(item) => {
                  const group = createMemo(() => {
                    const value = item()

                    return Array.isArray(value) ? value : undefined
                  })

                  const reasoning = createMemo(() => {
                    const value = item()

                    return !Array.isArray(value) && value.type === "reasoning" ? value : undefined
                  })

                  const callback = createMemo(() => {
                    const value = item()

                    return !Array.isArray(value) &&
                      (value.type === "notice" || value.type === "shell" || value.type === "text")
                      ? value
                      : undefined
                  })

                  const work = createMemo(() => {
                    const value = item()

                    return !Array.isArray(value) && value.type === "work" ? value : undefined
                  })

                  return (
                    <Show
                      when={group()}
                      fallback={
                        <Show
                          when={reasoning()}
                          fallback={
                            <Show
                              when={work()}
                              fallback={
                                <Show when={callback()}>
                                  {(part) => <div data-slot="context-tool-group-item">{part().render()}</div>}
                                </Show>
                              }
                            >
                              {(work) => (
                                <div data-slot="context-tool-group-item">
                                  <TimelineEventRow
                                    events={work().events}
                                    open={props.toolOpen?.(`events:${work().id}`) === true}
                                    onOpenChange={(open) => {
                                      props.onToolOpenChange?.(`events:${work().id}`, open)
                                      props.onSizeChange?.()
                                    }}
                                    onRevealShell={props.onRevealShell}
                                  />
                                </div>
                              )}
                            </Show>
                          }
                        >
                          {(part) => (
                            <div data-slot="context-tool-group-item">
                              <AssistantReasoningContent
                                id={part().id}
                                content={part()}
                                streaming={part().streaming ?? false}
                                defaultOpen={props.reasoningDefaultOpen}
                                open={props.reasoningOpen?.(part().id)}
                                onOpenChange={(open) => props.onReasoningOpenChange?.(part().id, open)}
                                onContentRendered={props.onSizeChange}
                              />
                            </div>
                          )}
                        </Show>
                      }
                    >
                      {(group) => (
                        <div data-slot="context-tool-group-item">
                          <GroupItem
                            tools={group()}
                            patchKey={patchKeys().get(group()[0]!)}
                            onSizeChange={props.onSizeChange}
                            toolDefaultOpen={props.toolDefaultOpen}
                            toolOpen={props.toolOpen}
                            onToolOpenChange={props.onToolOpenChange}
                            fileOpen={props.fileOpen}
                            onFileOpenChange={props.onFileOpenChange}
                          />
                        </div>
                      )}
                    </Show>
                  )
                }}
              </Index>
            </div>
          </BasicTool>
        </div>
      </Show>
    </Show>
  )
}

// One item in an opened group: files read together, a search, skills loaded together, files changed together, or a call.
function GroupItem(props: {
  tools: SessionMessageAssistantTool[]
  patchKey?: string
  onSizeChange?: () => void
  toolDefaultOpen?: (tool: SessionMessageAssistantTool) => boolean | undefined
  toolOpen?: (id: string) => boolean | undefined
  onToolOpenChange?: (id: string, open: boolean) => void
  fileOpen?: (path: string) => boolean | undefined
  onFileOpenChange?: (path: string, open: boolean) => void
}) {
  const tool = createMemo(() => props.tools[0]!)
  const name = createMemo(() => toolRule(tool()).name)

  return (
    <Switch
      fallback={
        <ToolDisplay
          id={tool().id}
          tool={name()}
          input={currentToolInput(tool())}
          metadata={currentToolMetadata(tool())}
          output={currentToolOutput(tool())}
          error={currentToolError(tool())}
          stopped={toolStopped(tool())}
          status={tool().state.status}
          defaultOpen={props.toolDefaultOpen?.(tool()) ?? false}
          open={props.toolOpen?.(tool().id) ?? props.toolDefaultOpen?.(tool())}
          onOpenChange={(open) => props.onToolOpenChange?.(tool().id, open)}
          deferContent
          virtualizeDiff={false}
          onContentRendered={props.onSizeChange}
        />
      }
    >
      <Match when={currentToolGroupedRead(tool())}>
        <CurrentReadToolGroup
          tools={props.tools}
          names={2}
          open={props.toolOpen?.(tool().id)}
          onOpenChange={(open) => props.onToolOpenChange?.(tool().id, open)}
          onSizeChange={props.onSizeChange}
        />
      </Match>
      <Match when={tool().state.status !== "error" && ["glob", "grep", "list"].includes(name())}>
        <SearchItem tool={tool()} />
      </Match>
      <Match when={props.tools.length > 1 && props.tools.every(loadsSkill)}>
        <SkillsItem tools={props.tools} />
      </Match>
      <Match when={changesFiles(tool())}>
        <FileGroup
          tools={props.tools}
          fileOpen={props.fileOpen && ((path) => props.fileOpen?.(`${props.patchKey}:${path}`))}
          onFileOpenChange={
            props.onFileOpenChange && ((path, open) => props.onFileOpenChange?.(`${props.patchKey}:${path}`, open))
          }
          onSizeChange={props.onSizeChange}
        />
      </Match>
    </Switch>
  )
}

// A search in an opened group: what was searched, and how many matches it found.
function SearchItem(props: { tool: SessionMessageAssistantTool }) {
  const i18n = useI18n()
  const trigger = createMemo(() => searchTrigger(props.tool, i18n))

  return (
    <div data-component="tool-trigger">
      <div data-slot="basic-tool-tool-trigger-content">
        <div data-slot="basic-tool-tool-info">
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer
                  text={trigger().title}
                  active={props.tool.state.status === "streaming" || props.tool.state.status === "running"}
                />
              </span>
              <Show when={trigger().subtitle}>
                {(subtitle) => <span data-slot="basic-tool-tool-subtitle">{subtitle()}</span>}
              </Show>
              <For each={trigger().args}>{(arg) => <span data-slot="basic-tool-tool-arg">{arg}</span>}</For>
            </div>
            <Show when={trigger().count}>
              {(count) => (
                <Badge data-slot="context-tool-group-match-count">
                  {i18n.plural("ui.messagePart.context.matchCount", count())}
                </Badge>
              )}
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}

function SkillsItem(props: { tools: SessionMessageAssistantTool[] }) {
  const i18n = useI18n()

  const skills = createMemo(() =>
    props.tools.flatMap((tool) => {
      const name = currentSkillName(tool)

      return name ? [name] : []
    }),
  )

  const marker = "__OPENCODE_LOADED_SKILL__"
  const loaded = createMemo(() => i18n.plural("ui.tool.loadedSkills", skills().length, { name: marker }))

  return (
    <div
      data-component="tool-loaded-item"
      data-timeline-part-ids={props.tools.map((item) => item.id).join(",")}
      aria-label={i18n.plural("ui.tool.loadedSkills", skills().length, { name: skills().join(", ") })}
    >
      <span data-slot="tool-loaded-label" aria-hidden="true">
        {loaded().split(marker)[0]?.trim()}
      </span>
      <span data-slot="tool-loaded-value" aria-hidden="true">
        <For each={skills()}>
          {(name, index) => (
            <>
              <Show when={index() > 0}>, </Show>
              <TextShimmer
                as="span"
                text={name}
                active={["streaming", "running"].includes(props.tools[index()]!.state.status)}
              />
            </>
          )}
        </For>
      </span>
      <Show when={loaded().split(marker)[1]?.trim()}>
        {(suffix) => (
          <span data-slot="tool-loaded-kind" aria-hidden="true">
            {suffix()}
          </span>
        )}
      </Show>
    </div>
  )
}

// A group with no calls says how many thoughts it holds, "Used 2 Thoughts", or else that it holds updates.
function UsedTitle(props: { label: ReturnType<typeof usedLabel> }) {
  return (
    <span data-slot="context-tool-group-title">
      <Show when={props.label.before || props.label.count || props.label.between}>
        <span data-slot="context-tool-group-usage">
          <Show when={props.label.before}>
            {(before) => <span data-slot="context-tool-group-prefix">{before()}</span>}
          </Show>
          <Show when={props.label.count}>
            {(count) => (
              <span data-slot="context-tool-group-count">
                <AnimatedNumber value={count()} />
              </span>
            )}
          </Show>
          <Show when={props.label.between}>
            {(between) => <span data-slot="context-tool-group-prefix">{between()}</span>}
          </Show>
        </span>
      </Show>
      <Show when={props.label.title}>{(title) => <span data-slot="basic-tool-tool-title">{title()}</span>}</Show>
      <Show when={props.label.after}>{(after) => <span data-slot="context-tool-group-prefix">{after()}</span>}</Show>
    </span>
  )
}

function usedLabel(parts: ActivityGroupPart[], i18n: UiI18n) {
  const count = parts.filter((part) => part.type === "reasoning").length

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

/**
 * What each subagent or background shell in a group did, for its label. Work that reports back anywhere in the group
 * that started it is counted once, as how it ended: "Finished", not "Started" and "Finished".
 */
function workEvents(parts: ActivityGroupPart[]) {
  const launch = (part: ActivityGroupPart) =>
    part.type === "tool" && toolRule(part).layout === "event" ? toolEvent(part) : undefined

  const launched = new Set(
    parts.flatMap((part) => {
      const event = launch(part)
      const key = event && workKey(event)

      return key ? [key] : []
    }),
  )

  const reports = new Map(
    parts.flatMap((part) => {
      const key = part.type === "event" ? workKey(part.event) : undefined

      return key && part.type === "event" ? [[key, part.event] as const] : []
    }),
  )

  return new Map(
    parts.flatMap((part): [ActivityGroupPart, TimelineEvent][] => {
      if (part.type === "event") {
        const key = workKey(part.event)

        return key && launched.has(key) ? [] : [[part, part.event]]
      }

      const event = launch(part)

      if (!event) return []
      const key = workKey(event)
      const outcome = key ? reports.get(key) : undefined

      return [
        [part, outcome && event.verb === "started" ? { ...event, verb: outcome.verb, failed: outcome.failed } : event],
      ]
    }),
  )
}

// The most consequential work names a group: changing files over running commands, and both over reading.
const modePriority: ToolMode[] = ["edit", "run", "tool", "explore"]

const modeVerb = {
  explore: "ui.timeline.activity.explored",
  edit: "ui.timeline.activity.edited",
  run: "ui.timeline.activity.ran",
  tool: "ui.timeline.activity.used",
} as const

const decodeChangedPath = Schema.decodeUnknownOption(Schema.Struct({ file: Schema.String }))

/**
 * Names a stretch of the agent's work by its main mode, then what its other calls did: "Edited 4 files · 2 commands,
 * started 1 shell". Work that runs on is counted by what happened to it, not among the calls that started it; a
 * stretch of only that reads like an events row: "Started 2 subagents · finished 2 subagents".
 */
function activityLabel(group: SessionMessageAssistantTool[], events: TimelineEvent[], i18n: UiI18n) {
  const tools = group.filter((tool) => toolRule(tool).layout !== "event")
  const launches = summarizeEvents(events).verbs

  const launched = launches.flatMap((bucket) =>
    bucket.kinds.map((item) => i18n.plural(launchKeys[bucket.verb][item.kind], item.count)),
  )

  const modes = new Set(tools.map((tool) => toolRule(tool).mode))
  const mode = modePriority.find((item) => modes.has(item))

  if (!mode) {
    const [first, ...rest] = launches

    if (!first) return

    return {
      verb: i18n.t(verbKeys[first.verb]),
      main: first.kinds.map((item) => i18n.plural(kindKeys[item.kind], item.count)).join(", "),
      others: rest.length ? launched.slice(first.kinds.length) : [],
    }
  }

  const calls = (item: ToolMode) => tools.filter((tool) => toolRule(tool).mode === item)
  const count = (names: string[]) => tools.filter((tool) => names.includes(toolRule(tool).name)).length
  const reads = new Set(tools.flatMap((tool) => (tool.name === "read" ? [toolInput(currentToolInput(tool)).path] : [])))

  const files = [
    ...new Set(
      calls("edit").flatMap((tool) => {
        const changed = (toolMetadata(currentToolMetadata(tool)).files ?? []).flatMap((file) =>
          Option.toArray(decodeChangedPath(file)).map((value) => value.file),
        )

        const path = toolInput(currentToolInput(tool)).path

        return changed.length ? changed : path ? [path] : []
      }),
    ),
  ]

  // Reads count as files where exploring names the group, and as reads beside other work.
  const explore = (main: boolean) =>
    [
      [main ? "ui.timeline.activity.files" : "ui.timeline.activity.reads", reads.size] as const,
      ["ui.timeline.activity.searches", count(["glob", "grep", "list"])] as const,
      ["ui.timeline.activity.webSearches", count(["websearch"])] as const,
      ["ui.timeline.activity.pages", count(["webfetch"])] as const,
      ["ui.timeline.activity.skills", count(["skill"])] as const,
    ].flatMap(([key, value]) => (value > 0 ? [i18n.plural(key, value)] : []))

  const runs = calls("run")
  // Commands are counted, never quoted: a command can be any length.
  const commands = runs.length ? [i18n.plural("ui.timeline.activity.commands", runs.length)] : []
  const used = [...new Set(calls("tool").map((tool) => toolTitle(tool, i18n)))]

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

// What a call is named in a group's label.
function toolTitle(tool: SessionMessageAssistantTool, i18n: UiI18n) {
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
  }[toolRule(tool).name]

  return key ? i18n.t(key) : tool.name
}

// A search in an opened group: what was searched, and how many matches it found.
function searchTrigger(tool: SessionMessageAssistantTool, i18n: UiI18n) {
  const input = toolInput(currentToolInput(tool))
  const metadata = toolMetadata(currentToolMetadata(tool))
  const subtitle = displayDirectory(input.path ?? "/")
  const name = toolRule(tool).name

  if (name === "list") return { title: i18n.t("ui.tool.list"), subtitle, args: [], count: undefined }

  if (name === "glob")
    return {
      title: i18n.t("ui.tool.glob"),
      subtitle,
      args: input.pattern ? [`pattern=${input.pattern}`] : [],
      count: metadata.count || undefined,
    }

  return {
    title: i18n.t("ui.tool.grep"),
    subtitle,
    args: [
      ...(input.pattern ? [`pattern=${input.pattern}`] : []),
      ...(input.include ? [`include=${input.include}`] : []),
    ],
    count: metadata.matches || undefined,
  }
}

// Calls that read files, load skills or change files one after another read as one item.
function joins(previous: SessionMessageAssistantTool, tool: SessionMessageAssistantTool) {
  return (
    (changesFiles(previous) && changesFiles(tool)) ||
    (currentToolGroupedRead(previous) && currentToolGroupedRead(tool)) ||
    (loadsSkill(previous) && loadsSkill(tool))
  )
}

function changesFiles(tool: SessionMessageAssistantTool) {
  return tool.state.status !== "error" && toolRule(tool).layout === "file"
}

function loadsSkill(tool: SessionMessageAssistantTool) {
  return tool.name === "skill" && tool.state.status !== "error" && !!currentSkillName(tool)
}
