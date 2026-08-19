import type { LocationRef } from "@opencode-ai/sdk/v2"
import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { useTuiConfig } from "../config"
import { useLocal } from "../context/local"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { DialogAlert } from "../ui/dialog-alert"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { DialogUsage } from "./dialog-usage"
import { fetchUsage, useUsageResource } from "./usage-client"
import { parseUsageCommand } from "./usage-command"
import { hasUsageSnapshot, type UsageEntry, type UsageResponse } from "./usage-data"
import { formatUsageResetLong, formatUsageWindowLabel } from "./usage-format"
import { resolveUsageProvider } from "./usage-provider"
import { usageRefreshFailed, usageRemember, usageShouldRefresh, usageWarning, usageWarningKey } from "./usage-toast"

export function useUsageController(sessionID: () => string | undefined, location: () => LocationRef | undefined) {
  const dialog = useDialog()
  const local = useLocal()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const tuiConfig = useTuiConfig()
  const usage = useUsageResource()
  const status = createMemo(() => sync.data.session_status?.[sessionID() ?? ""] ?? { type: "idle" })
  const [usageSuccessAt, setUsageSuccessAt] = createSignal(0)
  const [usageFailureAt, setUsageFailureAt] = createSignal(0)
  const [usageRefreshing, setUsageRefreshing] = createSignal(false)
  const [previousStatus, setPreviousStatus] = createSignal("idle")
  const usageSnapshot = new Map<string, UsageEntry["snapshot"]>()
  const usageShown = new Set<string>()
  let commandRequest = 0
  let refreshRequest = 0

  onCleanup(() => {
    commandRequest += 1
    refreshRequest += 1
  })

  function show(commandText: string) {
    const command = parseUsageCommand(commandText, {
      show_usage_value_mode: tuiConfig.show_usage_value_mode,
    })
    if ("error" in command) {
      DialogAlert.show(dialog, "Usage", command.error)
      return false
    }

    const dialogRevision = dialog.revision
    const generation = ++commandRequest
    const requestLocation = location()
    if (!requestLocation) {
      DialogAlert.show(dialog, "Usage", "Usage is unavailable until the session finishes loading.")
      return false
    }
    fetchUsage(sdk, { location: requestLocation, refresh: true })
      .then((data) => {
        if (generation !== commandRequest || !sameLocation(requestLocation, location())) return
        if (!usageRefreshFailed(data.results)) usage.refetch()
        const errors = usageErrors(data)
        if (command.background) {
          if (errors.length > 0) {
            toast.show({
              title: "Usage",
              message: errors.join("\n"),
              variant: "error",
              duration: 5000,
            })
          }
          return
        }
        if (dialog.revision !== dialogRevision) return
        if (data.results.length > 0) {
          dialog.replace(() => <DialogUsage results={data.results} initialMode={command.mode} />)
          return
        }
        DialogAlert.show(
          dialog,
          "Usage",
          "No OAuth providers with usage tracking are authenticated. Run: opencode auth login",
        )
      })
      .catch((error: unknown) => {
        if (generation !== commandRequest || !sameLocation(requestLocation, location())) return
        const message = error instanceof Error ? error.message : String(error)
        if (command.background) {
          toast.show({
            title: "Usage",
            message,
            variant: "error",
            duration: 5000,
          })
          return
        }
        if (dialog.revision !== dialogRevision) return
        DialogAlert.show(dialog, "Usage", message)
      })

    return true
  }

  createEffect(
    on(
      () => status().type,
      (current) => {
        const previous = previousStatus()
        setPreviousStatus(current)
        if (previous === "idle") return
        if (current !== "idle") return

        const provider = resolveUsageProvider({
          scope: "current",
          modelProviderID: local.model.current()?.providerID ?? null,
        })
        if (!provider) {
          usage.refetch()
          return
        }

        const requestLocation = location()
        if (!requestLocation) return
        const now = Date.now()
        if (
          !usageShouldRefresh({
            now,
            successAt: usageSuccessAt(),
            failureAt: usageFailureAt(),
            refreshing: usageRefreshing(),
          })
        ) {
          return
        }

        setUsageRefreshing(true)

        const generation = ++refreshRequest
        fetchUsage(sdk, { location: requestLocation, provider, refresh: true })
          .then((data) => {
            if (generation !== refreshRequest || !sameLocation(requestLocation, location())) return
            usageToast(data.results.filter(hasUsageSnapshot))
            if (usageRefreshFailed(data.results)) {
              setUsageSuccessAt(0)
              setUsageFailureAt(Date.now())
              return
            }
            usage.refetch()
            setUsageFailureAt(0)
            setUsageSuccessAt(Date.now())
          })
          .catch(() => {
            if (generation !== refreshRequest || !sameLocation(requestLocation, location())) return
            setUsageSuccessAt(0)
            setUsageFailureAt(Date.now())
          })
          .finally(() => {
            if (generation !== refreshRequest) return
            setUsageRefreshing(false)
          })
      },
    ),
  )

  function usageToast(entries: UsageEntry[]) {
    for (const entry of entries) {
      const previous = usageSnapshot.get(entry.provider)
      usageSnapshot.set(entry.provider, entry.snapshot)
      const warning = usageWarning(entry, previous)
      if (!warning) continue

      const key = usageWarningKey(entry.provider, warning)
      if (!usageRemember(usageShown, key)) continue

      const label = formatUsageWindowLabel(warning.label, warning.windowMinutes)
      const reset = warning.resetsAt ? ` Resets ${formatUsageResetLong(warning.resetsAt)}.` : ""

      toast.show({
        title: `${entry.displayName} usage`,
        message: `${label} reached ${Math.round(warning.usedPercent)}% used.${reset} Run /usage for details.`,
        variant: warning.threshold >= 95 ? "error" : "warning",
        duration: 5000,
      })
    }
  }

  return { show }
}

function usageErrors(data: UsageResponse): string[] {
  return data.results.flatMap((result) => (result.error ? [result.error.message] : []))
}

function sameLocation(left: LocationRef | undefined, right: LocationRef | undefined) {
  return left?.directory === right?.directory && left?.workspaceID === right?.workspaceID
}
