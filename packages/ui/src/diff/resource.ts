import { createMemo, createResource, type Accessor } from "solid-js"
import type { DiffSource } from "../components/session-diff"
import { prepareDiff } from "./client"
import { snapshotSource } from "./client-core"

export function createPreparedDiff(source: Accessor<DiffSource | undefined>) {
  const snapshot = createDiffSource(source)
  if (typeof Worker === "undefined") return [() => undefined] as const
  return createResource(snapshot, (value) =>
    prepareDiff(value).catch((error) => {
      console.error("failed to prepare diff", error)
      return undefined
    }),
  )
}

export function createDiffSource(source: Accessor<DiffSource | undefined>) {
  return createMemo(
    () => {
      const value = source()
      return value ? snapshotSource(value) : undefined
    },
    undefined,
    {
      equals: (a, b) =>
        a?.file === b?.file && a?.patch === b?.patch && a?.before === b?.before && a?.after === b?.after,
    },
  )
}
