import { useSonner as useBaseSonner } from "@/providers/sonner-provider"
import type { SonnerConfig } from "@/types/sonner"

export const useSonner = () => {
  const { showSonner, updateSonner, hideSonner, clearAll, sonners } = useBaseSonner()

  const success = (title: string, options?: Partial<Omit<SonnerConfig, "id" | "type" | "title">>) => {
    return showSonner({
      type: "success",
      title,
      ...options,
    })
  }

  const error = (title: string, options?: Partial<Omit<SonnerConfig, "id" | "type" | "title">>) => {
    return showSonner({
      type: "error",
      title,
      ...options,
    })
  }

  const info = (title: string, options?: Partial<Omit<SonnerConfig, "id" | "type" | "title">>) => {
    return showSonner({
      type: "info",
      title,
      ...options,
    })
  }

  const warning = (title: string, options?: Partial<Omit<SonnerConfig, "id" | "type" | "title">>) => {
    return showSonner({
      type: "warning",
      title,
      ...options,
    })
  }

  const loading = (title: string, options?: Partial<Omit<SonnerConfig, "id" | "type" | "title">>) => {
    return showSonner({
      type: "loading",
      title,
      persistent: true, // Loading sonners should not auto-dismiss
      ...options,
    })
  }

  const secondary = (title: string, options?: Partial<Omit<SonnerConfig, "id" | "type" | "title">>) => {
    return showSonner({
      type: "secondary",
      title,
      ...options,
    })
  }

  // Helper for transaction flows
  const transaction = {
    start: (title: string = "Processing transaction") => {
      return loading(title, { updatable: true })
    },
    success: (id: string, title: string = "Transaction successful") => {
      updateSonner(id, {
        type: "success",
        title,
        persistent: false,
        duration: 4000,
      })
    },
    error: (id: string, title: string = "Transaction failed") => {
      updateSonner(id, {
        type: "error",
        title,
        persistent: false,
        duration: 5000,
      })
    },
  }

  return {
    // Core methods
    show: showSonner,
    update: updateSonner,
    hide: hideSonner,
    clear: clearAll,
    sonners,

    // Convenience methods
    success,
    error,
    info,
    warning,
    loading,
    secondary,

    // Transaction helper
    transaction,
  }
}
