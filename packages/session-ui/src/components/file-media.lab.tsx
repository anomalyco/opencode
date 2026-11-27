import { Button } from "@opencode/ui/button"
import { FileComponentProvider } from "@opencode/ui/context/file"
import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import audio from "@opencode/ui/audio/alert-03.mp3?inline"
import image from "../../../ui/src/assets/favicon/web-app-manifest-192x192.png?inline"
import type { PresentationFileContent, PresentationFileDiff } from "../file-presentation"
import { File } from "./file"
import { SessionReview } from "./session-review"

const states = ["ready", "loading", "unavailable", "failed", "deleted"] as const

type Args = { kind: "image" | "audio"; state: (typeof states)[number] }

function MediaReview(props: Args) {
  const path = props.kind === "image" ? "assets/app-icon.png" : "assets/notification.mp3"

  const payload: PresentationFileContent = {
    type: "binary",
    encoding: "base64",
    mimeType: props.kind === "image" ? "image/png" : "audio/mpeg",
    content: (props.kind === "image" ? image : audio).split(",")[1]!,
  }

  // A Git LFS pointer is a text diff. Review expands it and FileMedia reads the underlying asset by path.
  const pointer = (hash: string) =>
    `version https://git-lfs.github.com/spec/v1\noid sha256:${hash.repeat(64)}\nsize 8102\n`

  const diffs: PresentationFileDiff[] = [
    {
      file: path,
      status: props.state === "deleted" ? "deleted" : "modified",
      before: pointer("0"),
      after: props.state === "deleted" ? "" : pointer("1"),
      additions: props.state === "deleted" ? 0 : 1,
      deletions: props.state === "deleted" ? 3 : 1,
    },
  ]

  const [state, setState] = createSignal(props.state)

  let finish: ((content?: PresentationFileContent) => void) | undefined

  onCleanup(() => finish?.())

  const readFile = createMemo(() => {
    const scenario = state()

    if (scenario === "unavailable" || scenario === "deleted") return undefined

    return async (file: string) => {
      if (file !== path) return

      if (scenario === "failed") throw new Error(`Could not read ${file}`)

      if (scenario === "loading")
        return new Promise<PresentationFileContent | undefined>((resolve) => {
          finish = resolve
        })

      return payload
    }
  })

  const complete = () => {
    finish?.(payload)
    setState("ready")
  }

  return (
    <FileComponentProvider component={File}>
      <div class="mx-auto h-[min(70dvh,480px)] w-full max-w-[800px]">
        <SessionReview
          title="Session changes"
          diffs={diffs}
          open={[path]}
          readFile={readFile()}
          actions={
            <Show when={state() === "loading" || state() === "failed"}>
              <Button size="small" variant="neutral" onClick={complete}>
                {state() === "failed" ? "Retry read" : "Complete read"}
              </Button>
            </Show>
          }
        />
      </div>
    </FileComponentProvider>
  )
}

export default {
  title: "OpenCode/Review/File media",
  id: "review-file-media",
  args: { kind: "image", state: "ready" } satisfies Args,
  argTypes: { kind: { options: ["image", "audio"] }, state: { options: states } },
  render: (args: Args) => (
    <Show when={{ kind: args.kind, state: args.state }} keyed>
      {(scenario) => <MediaReview {...scenario} />}
    </Show>
  ),
}

export const ImagePreview = {}

export const AudioPreview = { args: { kind: "audio" } }

export const Loading = { args: { state: "loading" } }

export const Unavailable = { args: { state: "unavailable" } }

export const FailedRead = { args: { state: "failed" } }

export const Removed = { args: { state: "deleted" } }
