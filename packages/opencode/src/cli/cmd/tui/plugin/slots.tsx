import { type SlotMode, type TuiPluginApi, type TuiSlotContext, type TuiSlotMap } from "@opencode-ai/plugin/tui"
import { createSlot, createSolidSlotRegistry, type JSX, type SolidPlugin } from "@opentui/solid"
import { isRecord } from "@/util/record"

type SlotProps<K extends keyof TuiSlotMap> = {
  name: K
  mode?: SlotMode
  children?: JSX.Element
} & TuiSlotMap[K]

type Slot = <K extends keyof TuiSlotMap>(props: SlotProps<K>) => JSX.Element | null
export type HostSlotPlugin = SolidPlugin<TuiSlotMap, TuiSlotContext>

export type HostPluginApi = TuiPluginApi
export type HostSlots = {
  register: (plugin: HostSlotPlugin) => () => void
}

function empty<K extends keyof TuiSlotMap>(_props: SlotProps<K>) {
  return null
}

let view: Slot = empty

export const Slot: Slot = (props) => view(props)

function isHostSlotPlugin(value: unknown): value is HostSlotPlugin {
  if (!isRecord(value)) return false
  if (typeof value.id !== "string") return false
  if (!isRecord(value.slots)) return false
  return true
}

export function setupSlots(api: HostPluginApi): HostSlots {
  const reg = createSolidSlotRegistry<TuiSlotMap, TuiSlotContext>(
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

  const slot = createSlot<TuiSlotMap, TuiSlotContext>(reg)
  view = (props) => slot(props)
  return {
    register(plugin) {
      if (!isHostSlotPlugin(plugin)) return () => {}
      return reg.register(plugin)
    },
  }
}
