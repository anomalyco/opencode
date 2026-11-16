import { For } from "solid-js"
import { DialogStoryRuntime } from "@/components-lab/dialog-story-runtime"
import type { BrowseBridge, BrowseStatus } from "@/runtime/platform/platform"
import { SettingsBrowse } from "./browse"

const installed = { installed: true, configured: true } as const

const states = {
  absent: { installed: false, configured: false, extension: "unknown", job: { status: "idle" } },
  installing: { installed: false, configured: false, extension: "unknown", job: { status: "installing" } },
  waiting: { ...installed, extension: "not-seen", job: { status: "installing" } },
  extension: { ...installed, extension: "not-seen", job: { status: "idle" } },
  config: { installed: true, configured: false, extension: "connected", job: { status: "idle" } },
  timedOut: {
    ...installed,
    extension: "not-seen",
    job: {
      status: "failed",
      failure: {
        reason: "installer",
        detail:
          "Not connected yet. If browse isn't connected after you add it, run `browse install` again, or `browse pair` for a code.",
      },
    },
  },
  download: {
    installed: false,
    configured: false,
    extension: "unknown",
    job: { status: "failed", failure: { reason: "download" } },
  },
  installed: { ...installed, extension: "unknown", job: { status: "idle" } },
  connected: { ...installed, extension: "connected", job: { status: "idle" } },
} satisfies Record<string, BrowseStatus>

type StateName = keyof typeof states

const STATE_NAMES: StateName[] = [
  "absent",
  "installing",
  "waiting",
  "extension",
  "config",
  "timedOut",
  "download",
  "installed",
  "connected",
]

const bridge = (status: BrowseStatus): BrowseBridge => ({
  status: () => Promise.resolve(status),
  install: () => new Promise(() => {}),
})

function BrowseStory(props: { names: StateName[]; width?: number }) {
  return (
    <DialogStoryRuntime>
      <div class="flex flex-col gap-6 bg-v2-background-bg-base p-6" style={{ width: `${props.width ?? 720}px` }}>
        <For each={props.names}>
          {(name) => <SettingsBrowse bridge={bridge(states[name])} onInstalled={() => {}} />}
        </For>
      </div>
    </DialogStoryRuntime>
  )
}

export default {
  title: "App/Settings/Browse",
  id: "app-settings-browse",
}

export const States = { render: () => <BrowseStory names={STATE_NAMES} /> }

export const Narrow = { render: () => <BrowseStory names={["waiting", "timedOut", "extension"]} width={360} /> }
