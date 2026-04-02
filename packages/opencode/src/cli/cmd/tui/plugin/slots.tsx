import type { TuiPluginApi, TuiSlotContext, TuiSlotMap, TuiSlotProps } from "@opencode-ai/plugin/tui"
import { createSlot, createSolidSlotRegistry, type JSX, type SolidPlugin } from "@opentui/solid"
import { isRecord } from "@/util/record"

type RuntimeSlotMap = TuiSlotMap<Record<string, object>>

type Slot = <Name extends string>(props: TuiSlotProps<Name>) => JSX.Element | null
export type HostSlotPlugin<Slots extends Record<string, object> = {}> = SolidPlugin<TuiSlotMap<Slots>, TuiSlotContext>

export type HostPluginApi = TuiPluginApi
export type HostSlots = {
  register: {
    (plugin: HostSlotPlugin): () => void
    <Slots extends Record<string, object>>(plugin: HostSlotPlugin<Slots>): () => void
  }
}

function empty<Name extends string>(_props: TuiSlotProps<Name>) {
  return null
}

let view: Slot = empty

export const Slot: Slot = (props) => view(props)

function isHostSlotPlugin(value: unknown): value is HostSlotPlugin<Record<string, object>> {
  if (!isRecord(value)) return false
  if (typeof value.id !== "string") return false
  if (!isRecord(value.slots)) return false
  return true
}

export function setupSlots(api: HostPluginApi): HostSlots {
  const reg = createSolidSlotRegistry<RuntimeSlotMap, TuiSlotContext>(
    api.renderer,
    {
      theme: api.theme,
    },
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

  const slot = createSlot<RuntimeSlotMap, TuiSlotContext>(reg)
  view = (props) => slot(props)
  return {
    register(plugin: HostSlotPlugin) {
      if (!isHostSlotPlugin(plugin)) return () => {}
      return reg.register(plugin)
    },
  }
}
