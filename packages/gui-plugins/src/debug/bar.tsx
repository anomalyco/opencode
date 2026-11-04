import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { usePlugin } from "@opencode/plugin/gui"
import { motionGlobals, motionTuning } from "@opencode/ui/motion-tuning"
import { duration } from "@opencode/util/duration"
import { SessionTurn } from "@opencode/util/session-turn"
import { builtinContext } from "@opencode/plugin/gui/builtin"

const fixed = (n?: number, digits = 0) => {
  if (n === undefined || Number.isNaN(n)) return

  return n.toFixed(digits)
}

function Cell(props: { dim?: boolean; inline?: boolean; label: string; tip: string; value: string }) {
  const content = () => (
    <div
      classList={{
        "flex min-w-0 items-center": true,
        "min-h-[20px] w-fit justify-start px-1.5 py-0.5 text-left": !!props.inline,
        "justify-center text-center": !props.inline,
        "min-h-[42px] w-full flex-col rounded-[8px] px-0.5 py-1": !props.inline,
      }}
    >
      <div
        classList={{
          "flex min-w-0": true,
          "-translate-y-px items-baseline gap-1.5": !!props.inline,
          "flex-col items-center": !props.inline,
        }}
      >
        <div
          dir="ltr"
          classList={{
            "text-[10px] leading-none font-black uppercase tracking-[0.04em] opacity-70": true,
          }}
        >
          {props.label}
        </div>
        <div
          dir="ltr"
          classList={{
            "uppercase font-bold tabular-nums": true,
            "text-[11px] leading-text-tight": !!props.inline,
            "text-[13px] leading-text-compact sm:text-[14px]": !props.inline,
            "opacity-70": !!props.dim,
          }}
        >
          {props.value}
        </div>
      </div>
    </div>
  )

  return (
    <Tooltip appearance={props.inline ? "compact" : "standard"} value={props.tip} placement="top">
      {content()}
    </Tooltip>
  )
}

function ToggleCell(props: {
  active: boolean
  inline?: boolean
  label: string
  onClick: () => void
  tip: string
  value: string
}) {
  const content = () => (
    <button
      type="button"
      aria-label={`${props.label}: ${props.value}`}
      aria-pressed={props.active}
      classList={{
        "flex min-w-0 items-center font-mono uppercase hover:bg-surface-raised-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-v2-border-border-focus": true,
        "min-h-[20px] w-fit justify-start rounded px-1.5 py-0.5 text-left": !!props.inline,
        "min-h-[42px] w-full flex-col justify-center rounded-[8px] px-0.5 py-1 text-center": !props.inline,
        "bg-surface-raised-base text-text-strong": props.active,
      }}
      onClick={props.onClick}
    >
      <span
        classList={{
          flex: true,
          "-translate-y-px items-baseline gap-1.5": !!props.inline,
          "flex-col items-center": !props.inline,
        }}
      >
        <span dir="ltr" class="text-[10px] leading-none font-black tracking-[0.04em] opacity-70">
          {props.label}
        </span>
        <span dir="ltr" class="text-[11px] leading-none font-bold">
          {props.value}
        </span>
      </span>
    </button>
  )

  return (
    <Tooltip appearance={props.inline ? "compact" : "standard"} value={props.tip} placement="top">
      {content()}
    </Tooltip>
  )
}

export default function DebugBar(props: {
  /** The dev server's layout tools: the direction and focus toggles. */
  devTools?: boolean
  inline?: boolean
  memory?: { on: boolean; env: boolean; toggle: () => void }
  motion?: { open: boolean; toggle: () => void }
  onClose?: () => void
}) {
  const ctx = builtinContext(usePlugin())
  const router = ctx.router
  const locale = ctx.locale
  const desktop = ctx.desktop
  const sessions = ctx.sessions
  const [focus, setFocus] = createSignal(false)

  const target = createMemo(
    () => {
      const session = sessions.current()

      if (!session?.id) return

      return { server: session.server, data: session.server.data, id: session.id }
    },
    undefined,
    { equals: (a, b) => a?.data === b?.data && a?.id === b?.id },
  )

  // The numbers on the TUI's latest assistant footer, which follows a step that ended the turn, failed, or is retrying.
  const turn = createMemo(() => {
    const current = target()

    if (!current) return

    const messages = current.data.session.message.list(current.id)

    const index = messages.findLastIndex(
      (item) =>
        item.type === "assistant" &&
        Boolean(item.retry || item.error || (item.finish && !["tool-calls", "unknown"].includes(item.finish))),
    )

    if (index === -1) return

    const options = { index, legacy: SessionTurn.legacy(messages) }
    // The TUI hides a zero duration, which means the step has not completed.
    const elapsed = SessionTurn.duration(messages, messages[index], options)

    return {
      duration: elapsed ? duration(elapsed) : undefined,
      tps: SessionTurn.tokensPerSecond(messages, messages[index], options),
    }
  })

  // The Motion workspace's global speed, kept in view while tuning.
  const [globals, setGlobals] = createSignal({ speed: motionGlobals.speed.value, slow: motionGlobals.slow.value })
  onCleanup(
    motionTuning.subscribe(() => setGlobals({ speed: motionGlobals.speed.value, slow: motionGlobals.slow.value })),
  )

  const na = () => ctx.t("na").toUpperCase()

  const toggleFocus = async () => {
    if (!desktop) return
    const enabled = !focus()
    await desktop.forceFocus(enabled)
    setFocus(enabled)
  }

  onCleanup(() => {
    if (focus()) void desktop?.forceFocus(false).catch(() => undefined)
  })

  return (
    <aside
      aria-label={ctx.t("providerAriaLabel")}
      classList={{
        "pointer-events-auto hidden overflow-hidden text-text-strong md:block": true,
        "mt-[-6px] w-full shrink-0 px-3 py-1": !!props.inline,
        "fixed bottom-3 right-3 z-50 w-[308px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-v2-border-border-base bg-surface-raised-stronger-non-alpha p-0.5 shadow-[var(--shadow-lg-border-base)] sm:bottom-4 sm:right-4 sm:w-[324px]":
          !props.inline,
      }}
    >
      <div
        classList={{
          "font-mono": true,
          "gap-[9px]": !!props.inline,
          "gap-px": !props.inline,
          "flex w-full flex-nowrap items-center justify-start": !!props.inline,
          "grid-cols-4": !props.inline,
          grid: !props.inline,
        }}
      >
        <Show when={props.onClose}>
          <Tooltip appearance="compact" value={ctx.t("close.tip")} placement="top">
            <IconButton
              size="small"
              variant="ghost-muted"
              icon={<Icon name="close" />}
              aria-label={ctx.t("close.label")}
              onClick={() => props.onClose?.()}
            />
          </Tooltip>
        </Show>
        <Cell
          label={ctx.t("duration.label")}
          tip={ctx.t("duration.tip")}
          value={turn()?.duration ?? na()}
          dim={turn()?.duration === undefined}
          inline={props.inline}
        />
        <Cell
          label={ctx.t("tps.label")}
          tip={ctx.t("tps.tip")}
          value={fixed(turn()?.tps, 1) ?? na()}
          dim={turn()?.tps === undefined}
          inline={props.inline}
        />
        <Show when={props.devTools}>
          <ToggleCell
            active={locale.direction() === "rtl"}
            inline={props.inline}
            label={ctx.t("direction.label")}
            tip={ctx.t("direction.tip")}
            value={ctx.t(`direction.${locale.direction()}`)}
            onClick={() => locale.setDirection(locale.direction() === "rtl" ? "ltr" : "rtl")}
          />
          <Show when={desktop}>
            <ToggleCell
              active={focus()}
              inline={props.inline}
              label={ctx.t("focus.label")}
              tip={ctx.t("focus.tip")}
              value={ctx.t(focus() ? "focus.on" : "focus.off")}
              onClick={() => void toggleFocus()}
            />
          </Show>
        </Show>
        <Show when={props.memory}>
          {(memory) => (
            <ToggleCell
              active={memory().on}
              inline={props.inline}
              label={ctx.t("memory.label")}
              tip={ctx.t(memory().env ? "memory.tipEnv" : "memory.tip")}
              value={ctx.t(memory().env ? "memory.env" : memory().on ? "focus.on" : "focus.off")}
              onClick={() => memory().toggle()}
            />
          )}
        </Show>
        <Show when={props.motion}>
          <div class="ms-auto flex items-center gap-[9px]">
            {/* The lab's route exists only on the dev server and in Beta. */}
            {(import.meta.env.DEV || import.meta.env.VITE_OPENCODE_CHANNEL === "beta") && (
              <Tooltip appearance="compact" value={ctx.t("components.tip")} placement="top">
                <a
                  href="/components"
                  classList={{
                    "flex min-h-[20px] w-fit items-center rounded px-1.5 py-0.5 font-mono uppercase hover:bg-surface-raised-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-v2-border-border-focus": true,
                    "bg-surface-raised-base text-text-strong": router.path().startsWith("/components"),
                  }}
                >
                  <span
                    dir="ltr"
                    class="-translate-y-px text-[10px] leading-none font-black tracking-[0.04em] opacity-70"
                  >
                    {ctx.t("components.label")}
                  </span>
                </a>
              </Tooltip>
            )}
            <ToggleCell
              active={globals().speed !== 1}
              inline={props.inline}
              label={ctx.t("speed.label")}
              tip={ctx.t("speed.tip")}
              value={`${globals().speed.toFixed(2)}×`}
              onClick={() => motionTuning.set(motionGlobals.speed, nextSpeed(globals().speed))}
            />
            <ToggleCell
              active={globals().slow}
              inline={props.inline}
              label={ctx.t("slow.label")}
              tip={ctx.t("slow.tip")}
              value={ctx.t(globals().slow ? "focus.on" : "focus.off")}
              onClick={() => motionTuning.set(motionGlobals.slow, !globals().slow)}
            />
            <ToggleCell
              active={!!props.motion?.open}
              inline={props.inline}
              label={ctx.t("motion.label")}
              tip={ctx.t("motion.tip")}
              value={ctx.t(props.motion?.open ? "focus.on" : "focus.off")}
              onClick={() => props.motion?.toggle()}
            />
          </div>
        </Show>
      </div>
    </aside>
  )
}

// The bar's speed cell steps through the common slow-downs, then back to full speed.
function nextSpeed(speed: number) {
  return [0.5, 0.25, 1].find((step) => step < speed) ?? 1
}
