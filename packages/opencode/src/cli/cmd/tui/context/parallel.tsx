import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { Plan } from "@/parallel/schema"

export type ParallelRoute = {
  type: "parallel"
  planID: string
}

export const { use: useParallel, provider: ParallelProvider } = createSimpleContext({
  name: "Parallel",
  init: () => {
    const [store, setStore] = createStore<{
      plan: Plan | null
    }>({
      plan: null,
    })

    return {
      get plan() {
        return store.plan
      },
      setPlan(plan: Plan | null | ((prev: Plan | null) => Plan | null)) {
        if (typeof plan === "function") {
          setStore("plan", plan(store.plan))
          return
        }
        setStore("plan", plan)
      },
    }
  },
})
