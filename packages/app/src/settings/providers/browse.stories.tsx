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
  pairing: { ...installed, extension: "unpaired", job: { status: "idle" } },
  update: { ...installed, extension: "incompatible", job: { status: "idle" } },
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
    job: {
      status: "failed",
      failure: { reason: "download", output: "https://opencode.ai/browse/install answered HTTP 503" },
    },
  },
  installerFailed: {
    installed: false,
    configured: false,
    extension: "unknown",
    job: {
      status: "failed",
      failure: {
        reason: "installer",
        detail: "checksum mismatch for browse-darwin-arm64",
        output: [
          "Installing browse (stable) for darwin-arm64",
          "Downloading https://anoma.ly/release/browse/stable/browse-darwin-arm64.gz",
          "  expected sha256 4f1c…9a2e",
          "  got      0b77…d310",
          "browse: checksum mismatch for browse-darwin-arm64",
        ].join("\n"),
      },
    },
  },
  connected: { ...installed, extension: "connected", job: { status: "idle" } },
} satisfies Record<string, BrowseStatus>

type StateName = keyof typeof states

// "connected" shows only after an install on this page: a browse already set up isn't offered. "timedOut" is an
// installer that gave up waiting for the extension, which offers the step that's left rather than an error.
const STATE_NAMES: StateName[][] = [
  ["absent"],
  ["installing"],
  ["waiting"],
  ["config"],
  ["extension"],
  ["pairing"],
  ["update"],
  ["timedOut"],
  ["download"],
  ["installerFailed"],
  ["waiting", "connected"],
]

/** Answers each read with the next status, then keeps the last one. */
const bridge = (names: StateName[]): BrowseBridge => {
  const reads = { count: 0 }

  return {
    status: () => Promise.resolve(states[names[Math.min(reads.count++, names.length - 1)]]),
    install: () => new Promise(() => {}),
  }
}

function BrowseStory(props: { names: StateName[][]; width?: number }) {
  return (
    <DialogStoryRuntime>
      <div class="flex flex-col bg-v2-background-bg-base p-6" style={{ width: `${props.width ?? 720}px` }}>
        <For each={props.names}>
          {(names) => {
            // Made once: the prop is read on every status read, and each bridge counts its own reads.
            const story = bridge(names)

            return <SettingsBrowse bridge={story} onInstalled={() => {}} />
          }}
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

export const Narrow = { render: () => <BrowseStory names={[["installing"], ["waiting"], ["download"]]} width={360} /> }
