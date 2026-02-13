/**
 * Tab File Content
 *
 * File viewer for Claxedo file tabs with syntax highlighting and line numbers.
 * Uses SDK directly (not FileProvider) to avoid SyncProvider's gate
 * which blocks rendering until sync data loads.
 * Renders via the `Code` component (@pierre/diffs) for full highlighting.
 *
 * Rendered inside SDKProvider only — no SyncProvider or FileProvider needed.
 */

import { Match, Switch, createEffect, createMemo, createSignal, on } from "solid-js"
import { useSDK } from "@/context/sdk"
import { Code } from "@opencode-ai/ui/code"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { getFilename } from "@opencode-ai/util/path"
import { checksum } from "@opencode-ai/util/encode"

export type TabFileProps = {
  path: string
  class?: string
}

export function TabFile(props: TabFileProps) {
  const sdk = useSDK()

  const [content, setContent] = createSignal<string | undefined>()
  const [error, setError] = createSignal<string | undefined>()
  const [loading, setLoading] = createSignal(true)

  const loadFile = (path: string) => {
    if (!path) return
    setLoading(true)
    setError(undefined)
    sdk.client.file
      .read({ path })
      .then((res) => {
        setContent(res.data?.content)
        setLoading(false)
      })
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }

  // Load on mount
  loadFile(props.path)

  // Reload when path changes
  createEffect(
    on(
      () => props.path,
      (path) => loadFile(path),
      { defer: true },
    ),
  )

  // Build FileContents for the Code component (name for syntax detection, contents, cacheKey)
  const file = createMemo(() => {
    const text = content()
    if (!text) return undefined
    return {
      name: getFilename(props.path),
      contents: text,
      cacheKey: checksum(text),
    }
  })

  return (
    <div class={`relative flex flex-col size-full min-h-0 overflow-hidden bg-background-base ${props.class ?? ""}`}>
      <div class="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border-weak-base bg-background-stronger">
        <FileIcon node={{ path: props.path, type: "file" }} class="shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-text-strong truncate">{getFilename(props.path)}</div>
          <div class="text-xs text-text-weak truncate">{props.path}</div>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-auto">
        <Switch>
          <Match when={loading()}>
            <div class="flex items-center gap-2 px-4 py-6 text-text-weak">
              <div class="size-4 rounded-full border-2 border-text-weak border-t-transparent animate-spin" />
              <span>Loading...</span>
            </div>
          </Match>

          <Match when={error()}>
            {(e) => <div class="px-4 py-6 text-red-500/80">{e()}</div>}
          </Match>

          <Match when={file()}>
            {(f) => (
              <Code file={f()} overflow="wrap" class="select-text" />
            )}
          </Match>

          <Match when={!loading()}>
            <div class="px-4 py-6 text-text-weak">No content</div>
          </Match>
        </Switch>
      </div>
    </div>
  )
}
