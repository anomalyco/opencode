import { createSimpleContext } from "@opencode-ai/ui/context"
import { useStorageSignal } from "@/hooks/use-storage-signal"

const key = "devMode"
const STRING_TRUE = "true"

export function createClientEnv() {
  const productionLayout = import.meta.env.VITE_PRODUCTION_LAYOUT === STRING_TRUE
  const disablePromptFooter = import.meta.env.VITE_DISABLE_PROMPT_FOOTER === STRING_TRUE
  const disablePromptPermissions = import.meta.env.VITE_DISABLE_PROMPT_PERMISSIONS === STRING_TRUE
  const disablePromptTriggers = import.meta.env.VITE_DISABLE_PROMPT_TRIGGERS === STRING_TRUE
  const disableWysiwygOnly = import.meta.env.VITE_DISABLE_WYSIWYG_ONLY === STRING_TRUE
  const [devMode] = useStorageSignal(key, false, {
    storage: "local",
    parse: (value) => value === STRING_TRUE,
    stringify: (value) => (value ? STRING_TRUE : undefined),
  })

  return {
    devMode,
    productionLayout: () => productionLayout && !devMode(),
    disablePromptFooter: () => disablePromptFooter && !devMode(),
    disablePromptPermissions: () => disablePromptPermissions && !devMode(),
    disablePromptTriggers: () => disablePromptTriggers && !devMode(),
    disableWysiwygOnly: () => disableWysiwygOnly && !devMode(),
  }
}

export const { use: useClientEnv, provider: ClientEnvProvider } = createSimpleContext({
  name: "ClientEnv",
  init: createClientEnv,
})
