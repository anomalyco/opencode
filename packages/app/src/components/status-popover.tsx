import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { Suspense, createMemo, createSignal, lazy, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"

const Body = lazy(() => import("./status-popover-body").then((x) => ({ default: x.StatusPopoverBody })))

export function StatusPopover() {
  const language = useLanguage()
  const server = useServer()
  const sync = useSync()
  const [shown, setShown] = createSignal(false)
  const ready = createMemo(() => server.healthy() === false || sync.data.mcp_ready)
  const healthy = createMemo(() => {
    const serverHealthy = server.healthy() === true
    const mcp = Object.values(sync.data.mcp ?? {})
    const issue = mcp.some((item) => item.status !== "connected" && item.status !== "disabled")
    return serverHealthy && !issue
  })

  return (
    <Popover
      open={shown()}
      onOpenChange={setShown}
      triggerAs={Button}
      triggerProps={{
        variant: "ghost",
        class: "titlebar-icon w-8 h-6 p-0 box-border",
        "aria-label": language.t("status.popover.trigger"),
        style: { scale: 1 },
      }}
      trigger={
        <div class="relative size-4">
          <div class="badge-mask-tight size-4 flex items-center justify-center">
            <Icon name={shown() ? "status-active" : "status"} size="small" />
          </div>
          <div
            classList={{
              "absolute -top-px -right-px size-1.5 rounded-full": true,
              "bg-icon-success-base": ready() && healthy(),
              "bg-icon-critical-base": server.healthy() === false || (ready() && !healthy()),
              "bg-border-weak-base": server.healthy() === undefined || !ready(),
            }}
          />
        </div>
      }
      class="[&_[data-slot=popover-body]]:p-0 w-[360px] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl"
      gutter={4}
      placement="bottom-end"
      shift={-168}
    >
      <Show when={shown()}>
        <Suspense
          fallback={
            <div class="w-[360px] h-14 rounded-xl bg-background-strong shadow-[var(--shadow-lg-border-base)]" />
          }
        >
          <Body shown={shown} />
        </Suspense>
      </Show>
    </Popover>
  )
}
