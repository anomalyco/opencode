import { timelinePresets, type TimelineDetail } from "@opencode/session-ui/timeline/detail"
import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { SettingsList } from "@/settings/list"
import { TimelineDetailControl } from "@/settings/timeline-detail"
import { SessionPreview } from "./story-model"
import {
  realTimelineCoverageDocument,
  realTimelineDocument,
  realTimelineFailureDocument,
  realTimelinePresentation,
  realTimelineVerboseDocument,
} from "./real-timeline-fixtures"
import "@/settings/settings.css"

const description = "anonymized seven-day session shape · lorem ipsum content"
const presets = Object.fromEntries(timelinePresets.map((preset) => [preset.id, preset.value])) as Record<
  string,
  TimelineDetail
>

function Representative(props: { preset: string }) {
  return (
    <SessionPreview
      title="Real Timeline"
      description={description}
      document={realTimelineDocument}
      presentation={realTimelinePresentation}
      timelineDetail={presets[props.preset] ?? timelinePresets[2].value}
      draft="Lorem ipsum dolor sit amet"
    />
  )
}

function TimelineSettingsPlayground() {
  const [state, setState] = createStore({ value: structuredClone(timelinePresets[2].value) as TimelineDetail })

  return (
    <div class="flex h-screen min-h-[640px] w-full flex-col bg-background-base lg:flex-row">
      <aside class="max-h-[46vh] w-full shrink-0 overflow-y-auto border-b border-border-weak-base bg-background-stronger p-4 lg:max-h-none lg:w-[420px] lg:border-b-0 lg:border-r">
        <SettingsList>
          <div class="py-5">
            <TimelineDetailControl value={state.value} onChange={(value) => setState("value", value)} />
          </div>
        </SettingsList>
      </aside>
      <section class="min-h-0 min-w-0 flex-1">
        <Show when={state.value} keyed>
          {(timelineDetail) => (
            <SessionPreview
              title="Real Timeline · settings playground"
              description={description}
              document={realTimelineDocument}
              presentation={realTimelinePresentation}
              timelineDetail={timelineDetail}
            />
          )}
        </Show>
      </section>
    </div>
  )
}

export default {
  title: "OpenCode/Session/Real Timeline",
  id: "app-real-timeline",
  component: SessionPreview,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Production Session timeline rendering with synthetic Lorem ipsum payloads shaped from a seven-day aggregate of local Session data. No original prompts, outputs, paths, URLs, or identifiers are retained.",
      },
    },
  },
}

export const PresetExplorer = {
  render: () => <TimelineSettingsPlayground />,
}

export const RepresentativeCompact = {
  render: () => <Representative preset="compact" />,
}

export const RepresentativeEverything = {
  render: () => <Representative preset="everything" />,
}

export const AllServerPartsEverything = {
  render: () => (
    <SessionPreview
      title="Real Timeline · all server parts"
      description={description}
      document={realTimelineCoverageDocument}
      timelineDetail={timelinePresets[0].value}
    />
  ),
}

export const AllServerPartsCompact = {
  render: () => (
    <SessionPreview
      title="Real Timeline · compact grouping"
      description={description}
      document={realTimelineCoverageDocument}
      timelineDetail={timelinePresets[2].value}
    />
  ),
}

export const FailuresQuiet = {
  render: () => (
    <SessionPreview
      title="Real Timeline · failures stay visible"
      description={description}
      document={realTimelineFailureDocument}
      timelineDetail={timelinePresets[3].value}
    />
  ),
}

export const FailuresTextOnly = {
  render: () => (
    <SessionPreview
      title="Real Timeline · text only"
      description={description}
      document={realTimelineFailureDocument}
      timelineDetail={timelinePresets[4].value}
    />
  ),
}

export const ExtremelyVerboseCompact = {
  render: () => (
    <SessionPreview
      title="Real Timeline · verbose values"
      description={description}
      document={realTimelineVerboseDocument}
      timelineDetail={timelinePresets[2].value}
    />
  ),
}

export const MobileCompact = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  parameters: { viewport: { defaultViewport: "mobile1" } },
  render: () => <Representative preset="compact" />,
}
