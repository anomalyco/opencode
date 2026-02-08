/**
 * Tab File Content
 *
 * Minimal file viewer for Claxedo file tabs.
 */

import { Match, Switch, createEffect, createMemo, on } from "solid-js"
import { useFile, useLanguage } from "@opencode-ai/claxedo-app"
import { getFilename } from "@opencode-ai/util/path"

export type TabFileProps = {
  path: string
  class?: string
}

export function TabFile(props: TabFileProps) {
  const file = useFile()
  const language = useLanguage()

  const state = createMemo(() => file.get(props.path))
  const content = createMemo(() => state()?.content?.content)
  const error = createMemo(() => state()?.error)
  const loading = createMemo(() => state()?.loading)
  const pending = createMemo(() => state() === undefined || loading())

  createEffect(
    on(
      () => props.path,
      (path) => {
        if (!path) return
        void file.load(path)
      },
      { defer: true },
    ),
  )

  return (
    <div class={`relative flex flex-col size-full min-h-0 overflow-hidden bg-background-base ${props.class ?? ""}`}>
      <div class="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border-weak-base bg-background-stronger">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-text-strong truncate">{getFilename(props.path)}</div>
          <div class="text-xs text-text-weak truncate">{props.path}</div>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-auto">
        <Switch>
          <Match when={pending()}>
            <div class="px-4 py-6 text-text-weak">{language.t("common.loading")}</div>
          </Match>

          <Match when={error()}>
            {(e) => <div class="px-4 py-6 text-red-500/80">{e()}</div>}
          </Match>

          <Match when={content()}>
            {(text) => (
              <pre class="px-4 py-6 text-sm leading-relaxed whitespace-pre overflow-x-auto">{text()}</pre>
            )}
          </Match>

          <Match when={true}>
            <div class="px-4 py-6 text-text-weak">No content</div>
          </Match>
        </Switch>
      </div>
    </div>
  )
}
