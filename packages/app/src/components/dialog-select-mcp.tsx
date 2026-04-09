import { useMutation } from "@tanstack/solid-query"
import { Component, createEffect, createMemo, For, on, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Switch } from "@opencode-ai/ui/switch"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  disabled: "mcp.status.disabled",
} as const

export const DialogSelectMcp: Component = () => {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const [state, setState] = createStore({
    done: false,
    loading: false,
  })

  const [pendingAuthUrls, setPendingAuthUrls] = createStore<Record<string, string>>({})

  createEffect(
    on(
      () => sync.data.mcp_ready,
      (ready, prev) => {
        if (!ready && prev) setState("done", false)
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    if (state.done || state.loading) return
    if (sync.data.mcp_ready) {
      setState("done", true)
      return
    }

    setState("loading", true)
    void sdk.client.mcp
      .status()
      .then((result) => {
        sync.set("mcp", result.data ?? {})
        sync.set("mcp_ready", true)
        setState("done", true)
      })
      .catch((err) => {
        setState("done", true)
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => {
        setState("loading", false)
      })
  })

  const items = createMemo(() =>
    Object.entries(sync.data.mcp ?? {})
      .map(([name, status]) => ({ name, status: status.status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const toggle = useMutation(() => ({
    mutationFn: async (name: string) => {
      const status = sync.data.mcp[name]
      if (status?.status === "connected") {
        await sdk.client.mcp.disconnect({ name })
      } else {
        const connectResult = await sdk.client.mcp.connect({ name })
        if (connectResult.data && typeof connectResult.data === "object" && "needs_oauth" in connectResult.data) {
          const { authorization_url } = connectResult.data as { needs_oauth: true; authorization_url: string }
          setPendingAuthUrls(name, authorization_url)
          return
        }
      }

      const result = await sdk.client.mcp.status()
      if (result.data) sync.set("mcp", result.data)
    },
  }))

  const enabledCount = createMemo(() => items().filter((i) => i.status === "connected").length)
  const totalCount = createMemo(() => items().length)

  return (
    <Dialog
      title={language.t("dialog.mcp.title")}
      description={language.t("dialog.mcp.description", { enabled: enabledCount(), total: totalCount() })}
    >
      <List
        search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.mcp.empty")}
        key={(x) => x?.name ?? ""}
        items={items}
        filterKeys={["name", "status"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        onSelect={(x) => {
          if (!x || toggle.isPending) return
          toggle.mutate(x.name)
        }}
        itemWrapper={(item, node) => (
          <div class="w-full">
            {node}
            <Show when={pendingAuthUrls[item.name]}>
              <div class="flex flex-col gap-3 p-4 bg-surface-raised-base rounded-sm">
                <p class="text-14-regular text-text-base">{language.t("mcp.oauth.authorizeRequired")}</p>
                <button
                  type="button"
                  class="self-end px-3 py-1.5 text-14-medium text-text-on-accent bg-accent-base rounded-md hover:bg-accent-base-hover transition-colors"
                  onClick={(e) => {
                    e.stopPropagation()
                    const url = pendingAuthUrls[item.name]
                    if (url) window.open(url, "_blank")
                    setPendingAuthUrls(
                      produce((draft) => {
                        delete draft[item.name]
                      }),
                    )
                  }}
                >
                  {language.t("mcp.oauth.openBrowser")}
                </button>
              </div>
            </Show>
          </div>
        )}
      >
        {(i) => {
          const mcpStatus = () => sync.data.mcp[i.name]
          const status = () => mcpStatus()?.status
          const statusLabel = () => {
            const key = status() ? statusLabels[status() as keyof typeof statusLabels] : undefined
            if (!key) return
            return language.t(key)
          }
          const error = () => {
            const s = mcpStatus()
            return s?.status === "failed" ? s.error : undefined
          }
          const enabled = () => status() === "connected"
          return (
            <div class="w-full flex items-center justify-between gap-x-3">
              <div class="flex flex-col gap-0.5 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="truncate">{i.name}</span>
                  <Show when={statusLabel()}>
                    <span class="text-11-regular text-text-weaker">{statusLabel()}</span>
                  </Show>
                  <Show when={toggle.isPending && toggle.variables === i.name}>
                    <span class="text-11-regular text-text-weak">{language.t("common.loading.ellipsis")}</span>
                  </Show>
                </div>
                <Show when={error()}>
                  <span class="text-11-regular text-text-weaker truncate">{error()}</span>
                </Show>
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <Switch
                  checked={enabled()}
                  disabled={toggle.isPending && toggle.variables === i.name}
                  onChange={() => {
                    if (toggle.isPending) return
                    toggle.mutate(i.name)
                  }}
                />
              </div>
            </div>
          )
        }}
      </List>
    </Dialog>
  )
}
