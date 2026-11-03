import { useOptionalConfig } from "../config"
import { createLanguage } from "../i18n/translate"

/** Mini loads its configured dictionary before mounting, including standalone footer surfaces. */
export function useMiniLanguage() {
  const config = useOptionalConfig()
  return createLanguage(() => config?.data.language ?? "en")
}
