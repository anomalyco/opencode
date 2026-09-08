import { createContext, useContext } from "solid-js"
import { usePlugin, type SessionContext } from "@opencode/plugin/desktop"
import type { LineRange, TextSelection, Annotation, SessionServices } from "@opencode/plugin/desktop/workspace"

export type SelectedLineRange = LineRange
export type FileSelection = TextSelection
export type LineComment = Annotation
export { selectionFromLines } from "@opencode/plugin/desktop/workspace"
export const Environment = createContext<{ session: SessionContext; services: SessionServices }>()
export function useEnvironment() {
  const value = useContext(Environment)
  if (!value) throw new Error("Review extension session is unavailable")
  return value
}
export const useFile = () => useEnvironment().services.files
export const useLanguage = () => usePlugin().i18n
export const usePlatform = () => usePlugin().platform
export const useComments = () => useEnvironment().services.annotations
export const useComposerState = () => useEnvironment().services.draft
export const useWorkspaceLocation = () => {
  const environment = useEnvironment()
  return () => ({ directory: environment.services.files.directory })
}
export const useServerSDK = () => {
  const environment = useEnvironment()
  return {
    get scope() {
      return environment.session.server.id
    },
    get api() {
      return environment.session.server.client
    },
  }
}
