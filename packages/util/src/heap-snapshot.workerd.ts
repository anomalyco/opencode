import { Effect } from "effect"

export const supported = false

export const write = (_directory: string) => Effect.fail(new Error("Heap snapshots are unsupported on this runtime"))
