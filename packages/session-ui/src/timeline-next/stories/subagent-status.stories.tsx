import { For, type JSX } from "solid-js"
import { CurrentSessionProviders } from "../../storybook/current-session-story"
import { storyDocument } from "../../storybook/current-session-scenarios"
import { TimelineEventItem } from "../event-row"
import type { TimelineEvent } from "../events"

/**
 * The status a subagent row in the New timeline leads with, in each state it can show: started, updated (a
 * follow-up to a running task), completed, failed and stopped.
 */
export default {
  title: "OpenCode/Timeline/Subagent status",
  id: "timeline-subagent-status",
  parameters: { layout: "fullscreen" },
}

const subagent = (event: Omit<TimelineEvent, "kind">): TimelineEvent => ({ kind: "subagent", ...event })

const states = [
  {
    label: "Started",
    event: subagent({ verb: "started", failed: false, agent: "explore", title: "Map the timeline grouping rules" }),
  },
  {
    label: "Updated",
    event: subagent({ verb: "updated", failed: false, agent: "review", title: "Also check the RTL layout" }),
  },
  {
    label: "Completed (background)",
    event: subagent({ verb: "finished", failed: false, agent: "test", title: "Run the focused timeline tests" }),
  },
  {
    label: "Completed (foreground)",
    event: subagent({ verb: "ran", failed: false, agent: "build", title: "Regenerate the SDK" }),
  },
  {
    label: "Failed",
    event: subagent({ verb: "finished", failed: true, agent: "test", title: "Run the e2e suite" }),
  },
  {
    label: "Stopped",
    event: subagent({ verb: "stopped", failed: false, agent: "explore", title: "Search for unused exports" }),
  },
]

const edges = [
  {
    label: "Long title",
    event: subagent({
      verb: "started",
      failed: false,
      agent: "explore",
      title:
        "Find every place the timeline projection groups tool calls, including the legacy renderer and the replay fixtures, and summarize how each handles background work",
    }),
  },
  { label: "No agent", event: subagent({ verb: "finished", failed: false, title: "Summarize the open issues" }) },
  { label: "No title", event: subagent({ verb: "stopped", failed: false, agent: "review" }) },
  {
    label: "Right-to-left title",
    event: subagent({ verb: "finished", failed: true, agent: "translator", title: "ترجمة سلاسل الواجهة إلى العربية" }),
  },
]

function Timeline(props: { children: JSX.Element }) {
  return (
    <CurrentSessionProviders document={storyDocument([])}>
      <div data-timeline="next" class="mx-auto flex w-full max-w-[720px] flex-col gap-8 px-6 py-8">
        {props.children}
      </div>
    </CurrentSessionProviders>
  )
}

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-3">
      <h2 class="text-[13px] leading-text-compact font-[530] text-v2-text-text-muted">{props.title}</h2>
      {props.children}
    </section>
  )
}

function Rows(props: { items: { label: string; event: TimelineEvent }[] }) {
  return (
    <div class="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-6 gap-y-3">
      <For each={props.items}>
        {(item) => (
          <>
            <span class="text-[12px] leading-text-compact text-v2-text-text-faint">{item.label}</span>
            <div data-component="timeline-subagent">
              <TimelineEventItem event={item.event} />
            </div>
          </>
        )}
      </For>
    </div>
  )
}

export const AllStates = {
  render: () => (
    <Timeline>
      <Section title="States">
        <Rows items={states} />
      </Section>
      <Section title="Edge cases">
        <Rows items={edges} />
      </Section>
    </Timeline>
  ),
}

export const Narrow = {
  render: () => (
    <div class="max-w-[360px]">
      <Timeline>
        <Section title="States at 360px">
          <div class="flex flex-col gap-4">
            <For each={[...states, ...edges]}>
              {(item) => (
                <div data-component="timeline-subagent">
                  <TimelineEventItem event={item.event} />
                </div>
              )}
            </For>
          </div>
        </Section>
      </Timeline>
    </div>
  ),
}
