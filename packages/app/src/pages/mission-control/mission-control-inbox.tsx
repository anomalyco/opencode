import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { createSignal, For, Show } from "solid-js"
import { MissionControlCard } from "./mission-control-card"
import type { MissionControlBucket, MissionControlController } from "./mission-control-controller"
import { MissionControlEmpty } from "./mission-control-empty"

export function MissionControlInbox(props: { controller: MissionControlController }) {
  const [showIdle, setShowIdle] = createSignal(false)
  const active = () => props.controller.data.buckets().filter((bucket) => bucket.id !== "idle" && bucket.records.length)
  const idle = () => props.controller.data.buckets().find((bucket) => bucket.id === "idle")
  const empty = () => active().length === 0 && !idle()?.records.length

  return (
    <ScrollView class="min-h-0 flex-1">
      <Show when={!empty()} fallback={<MissionControlEmpty controller={props.controller} />}>
        <div role="listbox" aria-label="Agent work queue" class="flex flex-col gap-5 px-2.5 pt-2.5 pb-10">
          <For each={active()}>{(bucket) => <Bucket controller={props.controller} bucket={bucket} />}</For>

          <Show when={idle()?.records.length}>
            <section class="flex min-w-0 flex-col gap-1">
              <button
                type="button"
                class="group flex h-8 min-w-0 items-center gap-2 rounded-[6px] px-2.5 text-start hover:bg-v2-overlay-simple-overlay-hover"
                aria-expanded={showIdle()}
                onClick={() => setShowIdle((value) => !value)}
              >
                <IconV2
                  name="chevron-down"
                  size="small"
                  class="shrink-0 text-v2-text-text-faint transition-transform duration-[120ms]"
                  classList={{ "-rotate-90": !showIdle() }}
                />
                <span class="text-[13px] leading-5 tracking-[-0.04px] text-v2-text-text-base [font-weight:530]">
                  Idle / done
                </span>
                <span class="text-[12px] leading-4 text-v2-text-text-muted [font-weight:440]">
                  {idle()!.records.length}
                </span>
                <span class="ms-auto text-[11px] leading-4 text-v2-text-text-faint [font-weight:440]">
                  {showIdle() ? "Hide" : "Show"}
                </span>
              </button>
              <Show when={showIdle()}>
                <div class="flex min-w-0 flex-col gap-px">
                  <For each={idle()!.records}>
                    {(record) => (
                      <MissionControlCard
                        controller={props.controller}
                        record={record}
                        selected={props.controller.selection.key() === record.key}
                      />
                    )}
                  </For>
                </div>
              </Show>
            </section>
          </Show>
        </div>
      </Show>
    </ScrollView>
  )
}

function Bucket(props: { controller: MissionControlController; bucket: MissionControlBucket }) {
  return (
    <section class="flex min-w-0 flex-col gap-1">
      <div class="flex h-7 min-w-0 items-center gap-2 px-2.5">
        <span class="text-[12px] leading-4 tracking-[0.04em] text-v2-text-text-base uppercase [font-weight:600]">
          {props.bucket.title}
        </span>
        <span class="text-[11px] leading-4 text-v2-text-text-faint [font-weight:440]">
          {props.bucket.records.length}
        </span>
      </div>
      <div class="flex min-w-0 flex-col gap-px">
        <For each={props.bucket.records}>
          {(record) => (
            <MissionControlCard
              controller={props.controller}
              record={record}
              selected={props.controller.selection.key() === record.key}
            />
          )}
        </For>
      </div>
    </section>
  )
}
