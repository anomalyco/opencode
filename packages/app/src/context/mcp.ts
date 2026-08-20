import { useMutation } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import type { McpServerConfig } from "@/context/server-sync"
import { showToast } from "@/utils/toast"

export function useMcpToggle() {
  const sync = useSync()
  const language = useLanguage()

  return useMutation(() => ({
    mutationFn: sync().mcp.toggle,
    onError: (error) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      }),
  }))
}

export function useMcpSave() {
  const sync = useSync()
  const language = useLanguage()

  return useMutation(() => ({
    mutationFn: (input: { name: string; config: McpServerConfig }) => sync().mcp.save(input.name, input.config),
    onError: (error) =>
      showToast({
        variant: "error",
        title: language.t("settings.mcp.toast.saveFailed"),
        description: error instanceof Error ? error.message : String(error),
      }),
  }))
}

export function useMcpRemove() {
  const sync = useSync()
  const language = useLanguage()

  return useMutation(() => ({
    mutationFn: (name: string) => sync().mcp.remove(name),
    onError: (error) =>
      showToast({
        variant: "error",
        title: language.t("settings.mcp.toast.removeFailed"),
        description: error instanceof Error ? error.message : String(error),
      }),
  }))
}
