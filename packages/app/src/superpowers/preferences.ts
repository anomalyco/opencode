import { Schema } from "effect"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { EXECUTION_SUBVIEWS, type ExecutionPreference, type ExecutionPreferenceStore } from "./model"

const executionPreferencesSchema = Persistence.struct({
  entries: Persistence.record(
    Persistence.fallback(
      Persistence.struct({
        subview: Persistence.optional(Schema.Literals(EXECUTION_SUBVIEWS)),
        taskID: Persistence.optional(Schema.String),
      }),
      () => ({}),
    ),
  ),
})

export function createExecutionPreferences(): ExecutionPreferenceStore {
  const [store, setStore] = persisted(Persist.global("execution"), executionPreferencesSchema, { entries: {} })
  return {
    get: (key): ExecutionPreference | undefined => store.entries[key],
    set: (key, value) => setStore("entries", key, value),
  }
}
