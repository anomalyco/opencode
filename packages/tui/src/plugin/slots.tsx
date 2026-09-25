/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi, TuiSlotContext, TuiSlotMap, TuiSlotProps } from "@opencode-ai/plugin/tui"
import { createSlot, createSolidSlotRegistry, type JSX, type SolidPlugin } from "@opentui/solid"
import { ErrorBoundary, createSignal } from "solid-js"
import { errorMessage } from "../util/error"
import { isRecord } from "../util/record"

type RuntimeSlotMap = TuiSlotMap<Record<string, object>>
type SlotView = <Name extends string>(props: TuiSlotProps<Name>) => JSX.Element | null

export type HostSlotPlugin<Slots extends Record<string, object> = {}> = SolidPlugin<TuiSlotMap<Slots>, TuiSlotContext>
export type HostPluginApi = TuiPluginApi
export type HostSlots = {
  register: {
    (plugin: HostSlotPlugin): () => void
    <Slots extends Record<string, object>>(plugin: HostSlotPlugin<Slots>): () => void
  }
  dispose: () => void
}

function isHostSlotPlugin(value: unknown): value is HostSlotPlugin<Record<string, object>> {
  if (!isRecord(value)) return false
  if (typeof value.id !== "string") return false
  return isRecord(value.slots)
}

export function createSlots() {
  const empty: SlotView = () => null
  const [view, setView] = createSignal<SlotView>(empty)
  // Plugin slot views can throw during render (e.g. optional snapshot fields
  // like tailHygiene.evaluable). Isolate those so they do not take down the TUI.
  const Slot: SlotView = (props) => (
    <ErrorBoundary
      fallback={(error) => {
        console.error("[tui.slot] plugin error", {
          slot: props.name,
          message: errorMessage(error),
        })
        return null
      }}
    >
      {view()(props)}
    </ErrorBoundary>
  )

  return {
    Slot,
    setup(api: HostPluginApi): HostSlots {
      const registry = createSolidSlotRegistry<RuntimeSlotMap, TuiSlotContext>(
        api.renderer,
        { theme: api.theme },
        {
          onPluginError(event) {
            console.error("[tui.slot] plugin error", {
              plugin: event.pluginId,
              slot: event.slot,
              phase: event.phase,
              source: event.source,
              message: event.error.message,
            })
          },
        },
      )
      const slot = createSlot<RuntimeSlotMap, TuiSlotContext>(registry)
      setView(() => (props: TuiSlotProps<string>) => slot(props))

      return {
        register(plugin: HostSlotPlugin) {
          if (!isHostSlotPlugin(plugin)) return () => {}
          return registry.register(plugin)
        },
        dispose() {
          setView(() => empty)
        },
      }
    },
    clear() {
      setView(() => empty)
    },
  }
}
