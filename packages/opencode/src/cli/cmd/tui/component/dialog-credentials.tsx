import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { TextAttributes } from "@opentui/core"

function formatCredentialLabel(meta: { namespace?: string; label?: string; id: string }) {
  const namespace = meta.namespace ?? "default"
  const label = meta.label ? meta.label : meta.id
  return `${namespace}/${label}`
}

export function DialogCredentials() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()

  const providerNames = createMemo(() => {
    const map = new Map<string, string>()
    for (const p of sync.data.provider_next.all) map.set(p.id, p.name)
    return map
  })

  const countsByProvider = createMemo(() => {
    const counts = new Map<string, number>()
    for (const c of sync.data.credential) {
      counts.set(c.providerId, (counts.get(c.providerId) ?? 0) + 1)
    }
    return counts
  })

  const options = createMemo(() => {
    const now = Date.now()
    const counts = countsByProvider()
    const names = providerNames()

    return [...sync.data.credential]
      .toSorted((a, b) => {
        if (a.providerId !== b.providerId) return a.providerId.localeCompare(b.providerId)
        const aNs = a.namespace ?? "default"
        const bNs = b.namespace ?? "default"
        if (aNs !== bNs) return aNs.localeCompare(bNs)
        if ((a.label ?? "") !== (b.label ?? "")) return (a.label ?? "").localeCompare(b.label ?? "")
        return a.createdAt - b.createdAt
      })
      .map((c) => {
        const cooldownUntil = c.health?.cooldownUntil
        const lastStatusCode = c.health?.lastStatusCode
        const providerTitle = names.get(c.providerId) ?? c.providerId
        const category = `${providerTitle} (${counts.get(c.providerId) ?? 0})`
        const cooldown =
          cooldownUntil && cooldownUntil > now ? cooldownUntil - now : 0
        const footer = cooldown
          ? `${c.kind ?? "unknown"} • cooldown ${(cooldown / 1000).toFixed(0)}s`
          : `${c.kind ?? "unknown"}${lastStatusCode ? ` • last ${lastStatusCode}` : ""}`

        return {
          value: c.id,
          title: providerTitle,
          description: formatCredentialLabel(c),
          category,
          footer: (
            <text fg={cooldown ? theme.warning : theme.textMuted} attributes={cooldown ? TextAttributes.BOLD : 0}>
              {footer}
            </text>
          ),
        } satisfies DialogSelectOption<string>
      })
  })

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("r")[0],
      title: "rename",
      onTrigger: async (option: DialogSelectOption<string>) => {
        const current = sync.data.credential.find((c) => c.id === option.value)
        const initial = current?.label ?? ""
        const next = await DialogPrompt.show(dialog, "New label", {
          placeholder: "default",
          value: initial,
          description: () => (
            <box gap={1}>
              <text fg={theme.textMuted}>Renames this credential label (namespace stays the same).</text>
            </box>
          ),
        })
        dialog.replace(() => <DialogCredentials />)
        if (next === null) return
        const label = next.split("\n")[0]?.trim()
        if (!label) return
        await sdk.client.credential.update({ credentialID: option.value, label })
        await sync.bootstrap()
      },
    },
    {
      keybind: Keybind.parse("d")[0],
      title: "delete",
      onTrigger: async (option: DialogSelectOption<string>) => {
        const confirm = await DialogPrompt.show(dialog, "Type DELETE to remove", {
          placeholder: "DELETE",
          description: () => (
            <box gap={1}>
              <text fg={theme.warning} attributes={TextAttributes.BOLD}>
                This cannot be undone.
              </text>
            </box>
          ),
        })
        dialog.replace(() => <DialogCredentials />)
        if (confirm !== "DELETE") return
        await sdk.client.credential.remove({ credentialID: option.value })
        await sync.bootstrap()
      },
    },
  ])

  return (
    <DialogSelect
      ref={(_ref: DialogSelectRef<string>) => {}}
      title="Credentials"
      options={options()}
      keybind={keybinds()}
      onSelect={() => {
        // no-op: actions are via keybinds
      }}
    />
  )
}
