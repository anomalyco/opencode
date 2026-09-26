import type { TuiPluginApi, TuiSlotContext, TuiSlotMap, TuiSlotProps } from "@opencode-ai/plugin/tui"
import { createSlot, createSolidSlotRegistry, type JSX, type SolidPlugin } from "@opentui/solid"
import { createSignal } from "solid-js"
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
  const Slot: SlotView = (props) => view()(props)

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
          if (!plugin.slots.sidebar_content) return registry.register(plugin)
          const sections = api.tuiConfig.sidebar_sections
          if (!sections) return registry.register(plugin)
          const name = plugin.id.startsWith("internal:sidebar-")
            ? plugin.id.slice("internal:sidebar-".length)
            : plugin.id
          const index = sections.order?.indexOf(name) ?? -1
          const hidden = sections.hidden?.includes(name)
          if (!hidden && index < 0) return registry.register(plugin)
          if (!hidden && Object.keys(plugin.slots).length === 1) {
            return registry.register({ ...plugin, order: Number.MIN_SAFE_INTEGER + index })
          }

          const other: HostSlotPlugin<RuntimeSlotMap>["slots"] = {}
          Object.assign(other, plugin.slots)
          delete other.sidebar_content
          if (hidden) return registry.register({ ...plugin, slots: other })

          const sectionSlots: HostSlotPlugin<RuntimeSlotMap>["slots"] = {}
          sectionSlots.sidebar_content = plugin.slots.sidebar_content
          const section = {
            id: plugin.id,
            order: Number.MIN_SAFE_INTEGER + index,
            slots: sectionSlots,
          }
          return registry.batch(() => {
            const disposeOther = registry.register({ ...plugin, id: `${plugin.id}:sidebar-other`, slots: other })
            const disposeSection = registry.register(section)
            return () =>
              registry.batch(() => {
                disposeSection()
                disposeOther()
              })
          })
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
