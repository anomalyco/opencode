import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import { AnimatedNumber } from "@opencode/ui/animated-number"
import { Badge } from "@opencode/ui/badge"
import { type UiI18n, useI18n } from "@opencode/ui/context/i18n"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { createMemo, For, Index, Match, Show, Switch } from "solid-js"
import { BasicTool } from "../../components/basic-tool"
import { useData } from "../../context"
import {
  currentToolError,
  currentToolGroupedRead,
  currentToolImages,
  currentToolInput,
  currentToolMetadata,
  currentToolOutput,
} from "../../message/current-tool-state"
import { AssistantReasoningContent } from "../../message/message-content"
import {
  CurrentReadToolGroup,
  currentSkillName,
  displayFolder,
  scrollParent,
  toolInput,
  toolMetadata,
  type ContextGroupPart,
} from "../../tools/tool-renderer"
import { TimelineEventRow } from "../event-row"
import { toolEvent, workKey, type TimelineEvent } from "../events"
import { toolRule } from "../rules"
import { sameFileFact, toolStopped } from "../../timeline/facts"
import { activityLabel, activityText, usedLabel } from "./activity-label"
import { FileGroup } from "./file-group"
import { ToolResultImages } from "../../tools/tool-result-images"
import { ThoughtRow } from "./thought"
import { ToolDisplay } from "./tool-display"

/** A part of an activity group: a call, a thought, a notice, or background work reporting back. */
export type ActivityGroupPart = ContextGroupPart | { type: "event"; id: string; event: TimelineEvent }

// Subagents and background work listed one after another in an opened group, as one nested events row.
type WorkRun = { type: "work"; id: string; events: TimelineEvent[] }

type ThoughtPart = Extract<ActivityGroupPart, { type: "reasoning" }>

// Thoughts one after another in an opened group, as one thought.
type ThoughtRun = { type: "thoughts"; id: string; parts: ThoughtPart[] }

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
  const data = useData()
  const reasoning = createMemo(() => props.parts.flatMap((part) => (part.type === "reasoning" ? [part] : [])))
  const thoughtsOnly = createMemo(() => reasoning().length > 0 && reasoning().length === props.parts.length)
  const events = createMemo(() => [...workEvents(props.parts).values()])

  const workOnly = createMemo(() => events().length > 0 && props.parts.every((part) => part.type === "event"))

  const activity = createMemo(() => activityLabel(props.parts, i18n, data.flag("full_codemode")))

  const label = createMemo(() => activityText(activity()) ?? usedLabel(props.parts, i18n))

  const items = createMemo(() =>
    (props.open ? props.parts : []).reduce<
      (
        | SessionMessageAssistantTool[]
        | Exclude<ActivityGroupPart, SessionMessageAssistantTool | { type: "event" } | { type: "reasoning" }>
        | WorkRun
        | ThoughtRun
      )[]
    >((groups, tool) => {
      const previous = groups.at(-1)

      if (tool.type === "event") {
        const event = tool.event
        const run = previous && !Array.isArray(previous) && previous.type === "work" ? previous : undefined

        if (run) {
          run.events.push(event)

          return groups
        }

        groups.push({ type: "work", id: tool.id, events: [event] })

        return groups
      }

      // Thoughts one after another open as one.
      if (tool.type === "reasoning") {
        if (previous && !Array.isArray(previous) && previous.type === "thoughts") {
          previous.parts.push(tool)

          return groups
        }

        groups.push({ type: "thoughts", id: tool.id, parts: [tool] })

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

    // The header rests its top margin away from the group's top, above it here. Anything past that is how far it is stuck.
    const stuck =
      !open && root && trigger
        ? trigger.getBoundingClientRect().top -
          root.getBoundingClientRect().top -
          parseFloat(getComputedStyle(trigger).marginTop)
        : 0

    if (stuck > 0 && root) scrollParent(root)?.scrollBy({ top: -stuck, behavior: "instant" })
    props.onOpenChange(open)
    props.onSizeChange?.()
  }

  return (
    <Show
      when={!thoughtsOnly()}
      fallback={
        <ThoughtRow
          parts={reasoning()}
          streaming={reasoning().some((part) => part.streaming)}
          defaultOpen={props.reasoningDefaultOpen}
          open={props.reasoningOpen?.(reasoning()[0]!.id)}
          onOpenChange={(open) => props.onReasoningOpenChange?.(reasoning()[0]!.id, open)}
          onContentRendered={props.onSizeChange}
        />
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

                    return !Array.isArray(value) && value.type === "thoughts" ? value : undefined
                  })

                  // A change keeps its card while progress reports rebuild the list around it.
                  const file = createMemo(
                    () => {
                      const value = item()

                      return !Array.isArray(value) && value.type === "file" ? value : undefined
                    },
                    undefined,
                    {
                      equals: (previous, next) =>
                        previous === next || (!!previous && !!next && sameFileFact(previous.file, next.file)),
                    },
                  )

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
                                <Show
                                  when={file()}
                                  keyed
                                  fallback={
                                    <Show when={callback()}>
                                      {(part) => <div data-slot="context-tool-group-item">{part().render()}</div>}
                                    </Show>
                                  }
                                >
                                  {(part) => (
                                    <div
                                      data-slot="context-tool-group-item"
                                      data-script-change={part.file.via === "script" ? "" : undefined}
                                    >
                                      {part.render()}
                                    </div>
                                  )}
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
                                content={part().parts[0]!}
                                more={part()
                                  .parts.slice(1)
                                  .map((item) => ({ id: item.id, content: item }))}
                                streaming={part().parts.some((item) => item.streaming)}
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
          <ToolResultImages
            images={props.parts.flatMap((part) => (part.type === "tool" ? currentToolImages(part) : []))}
            onContentRendered={props.onSizeChange}
          />
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
  const defaultOpen = createMemo(() => props.toolDefaultOpen?.(tool()))

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
          defaultOpen={defaultOpen() ?? false}
          open={props.toolOpen?.(tool().id) ?? defaultOpen()}
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

/**
 * What each background shell in a group did, for its label. Work that reports back anywhere in the group
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

// A search in an opened group: what was searched, and how many matches it found.
function searchTrigger(tool: SessionMessageAssistantTool, i18n: UiI18n) {
  const input = toolInput(currentToolInput(tool))
  const metadata = toolMetadata(currentToolMetadata(tool))
  const subtitle = displayFolder(input.path)
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
