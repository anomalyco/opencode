import type { SessionDocument } from "@opencode/session-ui/document"
import { CurrentSessionProviders, STORY_MODEL, STORY_TIME } from "@opencode/session-ui/storybook"
import { createReactiveTimelineProjection, TimelineRow } from "@opencode/session-ui/timeline/projection"
import { createSessionTimelineRowRenderer } from "@opencode/session-ui/timeline/row"
import type { TimelineRowLayout } from "@opencode/session-ui/timeline/text-layout"
import { DialogProvider } from "@opencode/ui/context/dialog"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { LanguageProvider } from "../src/runtime/i18n/language"
import { createTimelineVirtualizer } from "../src/session/timeline/virtualizer"

let report = () => ({
  count: 0,
  fallbacks: 0,
  expected: 0,
  extent: 0,
  offset: 0,
  viewport: 0,
  mounted: 0,
  // SAFETY: widens the empty initial list to the field's type.
  mismatches: [] as string[],
})

let reveal = (_id: string) => {}

export function mountLongTimeline(count = 1800) {
  const host = document.createElement("main")
  host.dataset.testid = "pretext-long-timeline"
  host.style.cssText =
    "position:fixed;inset:24px;width:744px;height:640px;z-index:1000;background:var(--v2-background-bg-base)"
  document.body.append(host)

  const fixture: SessionDocument = {
    sessionID: "pretext-long-session",
    status: { type: "idle" },
    diffs: [],
    messages: Array.from({ length: count }, (_, index) => index).flatMap((index) => [
      {
        id: `long-user-${index}`,
        type: "user" as const,
        text: `Question ${index + 1}: ${"Explain how this part of the timeline works. ".repeat(1 + (index % 4))}`,
        metadata: { agent: "build", model: STORY_MODEL },
        time: { created: STORY_TIME + index * 2 },
      },
      {
        id: `long-assistant-${index}`,
        type: "assistant" as const,
        agent: "build",
        model: STORY_MODEL,
        content: [
          {
            type: "text" as const,
            text: [
              `## Result ${index + 1}\n\n${"The prepared text preserves **strong words** and `inline code`. ".repeat(1 + (index % 7))}`,
              `A concrete implementation.\n\n\`\`\`ts\nconst result = ${index};\nconsole.log(result);\n\`\`\`\n\nThe source stays selectable.`,
              `These are the steps.\n\n- Prepare the text once.\n- Reuse its measured advances when the viewport changes.\n- Paint the same revision.\n\nReady.`,
            ][index % 3]!,
          },
        ],
        time: { created: STORY_TIME + index * 2, completed: STORY_TIME + index * 2 + 1 },
      },
    ]),
  }

  function Fixture() {
    const [state, setState] = createStore({ pinned: true })
    const sizes = new Map<string, TimelineRowLayout>()
    let viewport: HTMLDivElement | undefined

    const projection = createReactiveTimelineProjection({
      sessionMessages: () => fixture.messages,
      status: () => fixture.status,
      reasoningMode: () => "compact",
      shellToolDefaultOpen: () => false,
      editToolDefaultOpen: () => false,
    })

    const timeline = createTimelineVirtualizer({
      sessionKey: () => fixture.sessionID,
      projection,
      showHeader: () => false,
      layout: (row, environment) => {
        const value = renderer.layout(row, environment)
        sizes.set(TimelineRow.key(row), value)

        return value
      },
      pinned: () => state.pinned,
      scroll: () => ({ overflow: true, jump: !state.pinned }),
      setScrollRef: (element) => {
        viewport = element
      },
      setContentRef: () => {},
      onPin: () => setState("pinned", true),
      onUnpin: () => setState("pinned", false),
      onScheduleScrollState: () => {},
      onResumeScroll: () => {},
      onSelectionInteraction: () => {},
      onUserScroll: () => {},
      onHistoryScroll: () => {},
      canRenderImmediately: () => true,
      setRevealMessage: (callback) => {
        reveal = callback
      },
    })

    const renderer = createSessionTimelineRowRenderer({
      sessionID: () => fixture.sessionID,
      status: () => fixture.status,
      projection,
      presentation: () => undefined,
      reasoningMode: () => "compact",
      shellToolDefaultOpen: () => false,
      editToolDefaultOpen: () => false,
      disclosure: timeline.disclosure,
    })

    report = () => {
      const mounted = [...host.querySelectorAll<HTMLElement>("[data-timeline-key]")]

      return {
        count: projection.rows().length,
        fallbacks: projection.rows().filter((row) => sizes.get(TimelineRow.key(row))?.source === "dom").length,
        expected: [...sizes.values()].reduce((sum, value) => sum + (value.source === "dom" ? 0 : value.height), 82),
        extent: viewport?.scrollHeight ?? 0,
        offset: viewport?.scrollTop ?? 0,
        viewport: viewport?.clientHeight ?? 0,
        mounted: mounted.length,
        mismatches: mounted.flatMap((element) => {
          const key = element.dataset.timelineKey!
          const size = sizes.get(key)
          const natural = element.firstElementChild!.getBoundingClientRect().height

          return size && size.source !== "dom" && Math.abs(natural - size.height) > 1
            ? [`${key}: ${natural} != ${size.height}`]
            : []
        }),
      }
    }

    return (
      <timeline.View
        header={null}
        deferred={() => false}
        renderRow={(row, onSizeChange) => <renderer.Row row={row} onSizeChange={onSizeChange} />}
      />
    )
  }

  render(
    () => (
      <LanguageProvider locale="en">
        <DialogProvider>
          <CurrentSessionProviders document={fixture}>
            <Fixture />
          </CurrentSessionProviders>
        </DialogProvider>
      </LanguageProvider>
    ),
    host,
  )
}

export function longTimelineReport() {
  return report()
}

export function jumpLongTimeline(index: number) {
  reveal(`long-user-${index}`)

  return report()
}
