import { For, Show, createMemo, type JSX } from "solid-js"
import type { CoordTeamSummary } from "@opencode-ai/sdk/v2/client"
import { useLanguage } from "@/context/language"

export function SessionWorkersTab(props: { summary: CoordTeamSummary | null | undefined }): JSX.Element {
  const language = useLanguage()
  const members = createMemo(() => props.summary?.team.members ?? [])
  const inbox = createMemo(() => props.summary?.inbox ?? [])
  const unreadFor = (name: string) => inbox().find((item) => item.name === name)?.unread ?? 0

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <Show
        when={props.summary}
        fallback={<div class="h-full px-6 pb-30 flex flex-col items-center justify-center text-center text-text-weak">{language.t("session.workers.empty")}</div>}
      >
        <div class="px-6 pt-3 pb-2 border-b border-border-weak-base">
          <div class="text-14-medium text-text-strong">{props.summary?.team.name}</div>
          <Show when={props.summary?.team.description}>
            <div class="text-12-regular text-text-weak">{props.summary?.team.description}</div>
          </Show>
        </div>
        <div class="flex-1 overflow-auto">
          <For each={members()}>
            {(member) => (
              <div class="px-6 py-2 border-b border-border-weak-base flex items-center justify-between">
                <div class="flex flex-col">
                  <div class="text-14-regular text-text-strong">{member.name}</div>
                  <div class="text-12-regular text-text-weak">{member.agentType}</div>
                </div>
                <Show when={unreadFor(member.name) > 0}>
                  {(count) => (
                    <div class="text-12-medium text-text-strong h-5 px-2 flex items-center justify-center rounded-full bg-surface-base">
                      {count()}
                    </div>
                  )}
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
