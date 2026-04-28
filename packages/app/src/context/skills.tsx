import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "@/context/sdk"
import { cachedSkills, loadSkills, type SkillInfo } from "@/utils/skills"

export const { use: useSkills, provider: SkillsProvider } = createSimpleContext({
  name: "Skills",
  gate: false,
  init: () => {
    const sdk = useSDK()
    const [state, setState] = createStore({
      list: cachedSkills(sdk) ?? ([] as SkillInfo[]),
      loading: false,
    })

    createEffect(() => {
      sdk.client
      sdk.directory
      const hit = cachedSkills(sdk)
      if (hit) {
        setState("list", hit)
        setState("loading", false)
        return
      }

      setState("loading", true)
      void loadSkills(sdk)
        .then((list) => {
          setState("list", list)
        })
        .catch(() => undefined)
        .finally(() => {
          setState("loading", false)
        })
    })

    return {
      list: createMemo(() => state.list),
      loading: createMemo(() => state.loading),
      reload: () => loadSkills(sdk).then((list) => setState("list", list)),
    }
  },
})
