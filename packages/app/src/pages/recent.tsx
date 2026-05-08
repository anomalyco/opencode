import { createResource, createSignal, For, Show, createMemo } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Icon } from "@opencode-ai/ui/icon"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { type GlobalSession } from "@opencode-ai/sdk/v2/client"
import { useGlobalSDK } from "@/context/global-sdk"
import { DateTime } from "luxon"
import { flattenRecentRoots, organizeRecentSessions, recentPrefix, recentTime } from "@/utils/recent-session"

export default function Recent() {
  const navigate = useNavigate()
  const globalSDK = useGlobalSDK()
  const [search, setSearch] = createSignal("")

  const [sessions] = createResource(
    () => search(),
    async (query) => {
      const result = await globalSDK.client.experimental.session
        .list({
          limit: 100,
          search: query || undefined,
        })
        .catch(() => undefined)
      return (result?.data ?? []) as GlobalSession[]
    },
  )

  const data = createMemo(() => organizeRecentSessions(sessions() ?? []))

  function ago(ts: number) {
    return DateTime.fromMillis(ts).toRelative() ?? ""
  }

  function open(session: { id: string; directory: string }) {
    navigate(`/${base64Encode(session.directory)}/session/${session.id}`)
  }

  let timer: ReturnType<typeof setTimeout> | undefined

  function onSearch(val: string) {
    clearTimeout(timer)
    timer = setTimeout(() => setSearch(val), 300)
  }

  return (
    <div class="flex flex-col h-full bg-background-base">
      <div class="flex items-center gap-3 px-6 py-4 border-b border-border-base">
        <button
          class="flex items-center gap-1.5 text-color-secondary-base hover:text-color-primary-base transition-colors"
          onClick={() => navigate("/")}
        >
          <Icon name="arrow-left" class="size-4" />
        </button>
        <h1 class="text-16-semibold text-color-primary-base">Recently Active</h1>
        <div class="flex-1" />
        <div class="relative">
          <Icon
            name="magnifying-glass"
            class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-color-dimmed-base"
          />
          <input
            type="text"
            placeholder="Search sessions..."
            class="pl-8 pr-3 py-1.5 text-13-regular bg-background-surface-base border border-border-base rounded-md w-56 text-color-primary-base placeholder:text-color-dimmed-base focus:outline-none focus:border-border-focus-base"
            onInput={(e) => onSearch(e.currentTarget.value)}
          />
        </div>
      </div>

      <div class="flex-1 overflow-y-auto">
        <Show when={sessions.loading}>
          <div class="flex items-center justify-center py-12 text-color-dimmed-base text-13-regular">Loading...</div>
        </Show>

        <Show when={!sessions.loading && sessions()?.length === 0}>
          <div class="flex items-center justify-center py-12 text-color-dimmed-base text-13-regular">
            No sessions found
          </div>
        </Show>

        <div class="flex flex-col gap-6 px-4 py-4">
          <For each={data().sections}>
            {(group) => {
              const list = () =>
                flattenRecentRoots({
                  roots: group.items,
                  lookup: data().lookup,
                  children: data().children,
                })

              return (
                <section class="flex flex-col gap-1">
                  <div class="px-2 pb-1 text-[11px] leading-4 text-color-dimmed-base uppercase tracking-[0.08em]">
                    {group.label}
                  </div>
                  <div class="overflow-hidden rounded-xl border border-border-base">
                    <For each={list()}>
                      {(entry, index) => (
                        <button
                          classList={{
                            "w-full flex items-start gap-3 py-3 hover:bg-background-hover-base transition-colors text-left":
                              true,
                            "border-t border-border-base": index() > 0,
                          }}
                          style={{ "padding-left": `${16 + entry.depth * 18}px`, "padding-right": "16px" }}
                          onClick={() => open(entry.session)}
                        >
                          <div class="mt-0.5 shrink-0 text-color-dimmed-base">
                            <Show when={entry.depth > 0} fallback={<Icon name="status" class="size-3.5" />}>
                              <Icon name="fork" class="size-3.5" />
                            </Show>
                          </div>
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                              <span class="text-13-medium text-color-primary-base truncate">{entry.session.title}</span>
                              <Show when={entry.session.summary && entry.session.summary.files}>
                                <span class="shrink-0 text-11-regular text-color-dimmed-base">
                                  {entry.session.summary!.files} file{entry.session.summary!.files !== 1 ? "s" : ""}
                                </span>
                              </Show>
                            </div>
                            <div class="flex items-center gap-2 mt-0.5 min-w-0">
                              <span class="text-11-regular text-color-secondary-base truncate">
                                {recentPrefix(entry.session)}
                              </span>
                              <span class="shrink-0 text-11-regular text-color-dimmed-base">
                                {ago(recentTime(entry.session))}
                              </span>
                            </div>
                            <Show
                              when={
                                entry.session.summary && (entry.session.summary.additions || entry.session.summary.deletions)
                              }
                            >
                              <div class="flex items-center gap-1.5 mt-1">
                                <Show when={entry.session.summary!.additions}>
                                  <span class="text-11-regular text-icon-success-base">
                                    +{entry.session.summary!.additions}
                                  </span>
                                </Show>
                                <Show when={entry.session.summary!.deletions}>
                                  <span class="text-11-regular text-icon-critical-base">
                                    -{entry.session.summary!.deletions}
                                  </span>
                                </Show>
                              </div>
                            </Show>
                          </div>
                          <Icon name="chevron-right" class="size-4 text-color-dimmed-base shrink-0 mt-1" />
                        </button>
                      )}
                    </For>
                  </div>
                </section>
              )
            }}
          </For>
        </div>
      </div>
    </div>
  )
}
