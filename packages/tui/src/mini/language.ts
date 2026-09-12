import { createContext, useContext } from "solid-js"
import { createLanguage } from "../i18n/translate"

export type MiniLanguage = ReturnType<typeof createLanguage>
export const defaultMiniLanguage = createLanguage(() => "en")

// Mini has its own renderer root and does not mount the full TUI Config provider.
export const MiniLanguageContext = createContext<MiniLanguage>(defaultMiniLanguage)
export const useMiniLanguage = () => useContext(MiniLanguageContext)
