import { Widget } from "@opencode/schema/widget"
import { createSimpleContext } from "@opencode/ui/context"
import { Schema } from "effect"
import { produce } from "solid-js/store"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import type { ServerScope } from "@/runtime/server/scope"

export type WidgetCapability = Widget.Capability

const grantsSchema = Persistence.struct({
  grants: Persistence.record(Persistence.array(Schema.Literals(["read", "write", "full"]))),
})

const EMPTY: readonly WidgetCapability[] = []

const grantKey = (scope: ServerScope, id: string) => `${scope}\u0000${id}`

// Widget capabilities are granted by the user, never by the widget itself. The
// grant lives in local app storage, keyed by server scope and widget id, so a
// widget cannot escalate on its own and a global widget granted once stays
// granted across projects on the same server.
export const { use: useWidgetGrants, provider: WidgetGrantsProvider } = createSimpleContext({
  name: "WidgetGrants",
  gate: false,
  init: () => {
    const [store, setStore] = persisted(Persist.global("widget.capabilities"), grantsSchema, { grants: {} })

    const granted = (scope: ServerScope, id: string): readonly WidgetCapability[] =>
      store.grants[grantKey(scope, id)] ?? EMPTY

    const set = (scope: ServerScope, id: string, capabilities: readonly WidgetCapability[]) => {
      const key = grantKey(scope, id)
      const next = [...new Set(capabilities)]
      if (next.length === 0) {
        // Solid's setStore merges plain objects, so deleting a key needs a
        // produce for the removal to actually land in the store.
        setStore(
          "grants",
          produce((grants) => {
            delete grants[key]
          }),
        )
        return
      }
      setStore("grants", key, next)
    }

    const toggle = (scope: ServerScope, id: string, capability: WidgetCapability, enabled: boolean) => {
      const current = new Set(granted(scope, id))
      // Granting a higher level implies the lower ones; revoking one drops the
      // levels that depend on it so the effective set never has a hole.
      if (enabled) {
        current.add(capability)
        if (capability === "write" || capability === "full") current.add("read")
        if (capability === "full") current.add("write")
      } else {
        current.delete(capability)
        if (capability === "read") {
          current.delete("write")
          current.delete("full")
        }
        if (capability === "write") current.delete("full")
      }
      set(scope, id, [...current])
    }

    return { granted, set, toggle }
  },
})
