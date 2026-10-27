import { TextShimmer } from "@opencode/ui/text-shimmer"
import { For, type JSX } from "solid-js"
import { CurrentSessionProviders } from "../storybook/current-session-story"
import { storyDocument, storyTool } from "../storybook/current-session-scenarios"
import { timelinePresets } from "../timeline/detail"
import { SessionTimeline } from "../timeline/session-timeline"

export default {
  title: "OpenCode/Work/Subagent row variants",
  id: "current-subagent-row-variants",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Design alternatives for child-Session rows without the old agent square. Production is the first variant; the others are static story-only sketches.",
      },
    },
  },
}

const productionDocument = storyDocument(
  [
    storyTool("variant_glob", "glob", "completed", { pattern: "src/timeline/**/*.ts" }),
    storyTool("variant_grep", "grep", "completed", { pattern: "timelineDetail" }),
    storyTool("variant_read", "read", "completed", { path: "src/timeline/projection.ts" }),
    storyTool(
      "variant_explore",
      "subagent",
      "completed",
      { agent: "explore", description: "Map the timeline grouping rules", prompt: "Find where tool rows are grouped." },
      { output: "Grouping lives in the timeline projection.", metadata: { sessionID: "session_child_explore" } },
    ),
    storyTool(
      "variant_test",
      "subagent",
      "running",
      { agent: "test", description: "Run the focused timeline tests", prompt: "Run the timeline tests." },
      { metadata: { sessionID: "session_child_test" } },
    ),
    storyTool("variant_delegating", "subagent", "streaming", {}, { raw: "" }),
  ],
  true,
)

const sketchRows = [
  { title: "Explore", subtitle: "Map the timeline grouping rules", running: false },
  { title: "Test", subtitle: "Run the focused timeline tests", running: true },
]

function Frame(props: { title: string; children: JSX.Element }) {
  return (
    <section class="mx-auto w-full max-w-[720px] px-6 py-4">
      <h2 class="mb-3 text-[13px] leading-text-compact font-[530] text-v2-text-text-muted">{props.title}</h2>
      {props.children}
    </section>
  )
}

function SketchContext() {
  return (
    <div class="h-9 flex items-center text-[13px] leading-text-compact text-v2-text-text-base">
      <span class="text-v2-text-text-muted">Used 3&nbsp;</span>Glob, Grep, Read
    </div>
  )
}

function ShimmerWhileRunning() {
  return (
    <div class="flex flex-col gap-2 ps-6">
      <SketchContext />
      <For each={sketchRows}>
        {(row) => (
          <div data-component="task-tool-card" class="w-fit max-w-full">
            <div data-component="task-tool-surface">
              <div data-slot="basic-tool-tool-info-main" class="flex items-center">
                <span data-component="task-tool-title">
                  <TextShimmer as="span" text={row.title} active={row.running} />
                </span>
                <span data-slot="basic-tool-tool-subtitle">{row.subtitle}</span>
              </div>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}

function PlainLabel() {
  return (
    <div class="flex flex-col ps-6">
      <SketchContext />
      <For each={sketchRows}>
        {(row) => (
          <div class="h-9 flex items-center gap-2 text-[13px] leading-text-compact tracking-[-0.04px]">
            <span class="font-[530] text-v2-text-text-base">
              <TextShimmer as="span" text={row.title} active={row.running} />
            </span>
            <span class="font-[440] text-v2-text-text-muted">{row.subtitle}</span>
          </div>
        )}
      </For>
    </div>
  )
}

export const Variants = {
  render: () => (
    <div class="min-h-screen bg-v2-background-bg-base py-4">
      <Frame title="A. Dot-matrix spinner while running, no icon when done (production)">
        <CurrentSessionProviders document={productionDocument}>
          <SessionTimeline
            document={productionDocument}
            timelineDetail={{ ...timelinePresets[2].value, subagents: { placement: "separate" } }}
          />
        </CurrentSessionProviders>
      </Frame>
      <Frame title="B. No icon, shimmering title while running (sketch)">
        <ShimmerWhileRunning />
      </Frame>
      <Frame title="C. Plain label without a pill (sketch)">
        <PlainLabel />
      </Frame>
    </div>
  ),
}
