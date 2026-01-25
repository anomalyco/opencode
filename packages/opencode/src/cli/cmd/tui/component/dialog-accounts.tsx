import { createResource, createMemo, createSignal, For, Show } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Account } from "@/account"
import { TextAttributes } from "@opentui/core"
import { useDialog } from "@tui/ui/dialog"

export function DialogAccounts() {
  const { theme } = useTheme()
  const dialog = useDialog()

  const [accounts, { refetch }] = createResource(() => Account.list())
  const [actionMessage, setActionMessage] = createSignal<string | null>(null)

  const showMessage = (msg: string) => {
    setActionMessage(msg)
    setTimeout(() => setActionMessage(null), 2000)
  }

  const handleSwitch = async (account: Account.Entry) => {
    if (account.isActive) {
      showMessage("Already active")
      return
    }
    const success = await Account.setActive(account.id)
    if (success) {
      showMessage(`Switched to ${account.email || account.id}`)
      refetch()
    } else {
      showMessage("Failed to switch")
    }
  }

  const handleRefresh = async (account: Account.Entry) => {
    const success = await Account.clearRateLimits(account.id)
    if (success) {
      showMessage(`Cleared limits for ${account.email || account.id}`)
      refetch()
    } else {
      showMessage("Failed to clear limits")
    }
  }

  const handleDelete = async (account: Account.Entry) => {
    const success = await Account.remove(account.id)
    if (success) {
      showMessage(`Removed ${account.email || account.id}`)
      refetch()
    } else {
      showMessage("Failed to remove")
    }
  }

  const getStatusText = (status: Account.Status, isActive?: boolean): string => {
    if (isActive) return "★ Active"
    switch (status) {
      case "active": return "● Ready"
      case "rate_limited": return "◐ Limited"
      case "cooling_down": return "◐ Cooling"
      default: return "○"
    }
  }

  const options = createMemo((): DialogSelectOption<Account.Entry>[] => {
    const list = accounts() ?? []
    return list.map((account) => ({
      value: account,
      title: account.email || account.accountId || `Account #${(account.index ?? 0) + 1}`,
      category: account.provider,
      footer: getStatusText(account.status, account.isActive),
      onSelect: () => {
        dialog.replace(() => <DialogAccountDetail account={account} onBack={() => dialog.replace(() => <DialogAccounts />)} onRefetch={refetch} />)
      },
    }))
  })

  return (
    <box flexDirection="column">
      <Show when={actionMessage()}>
        <box paddingLeft={4} paddingBottom={1}>
          <text fg={theme.accent}>{actionMessage()}</text>
        </box>
      </Show>
      <DialogSelect
        title="Accounts"
        placeholder="Search accounts..."
        options={options()}
        skipFilter={false}
        keybind={[
          {
            keybind: { key: "s" },
            title: "switch",
            onTrigger: (opt) => handleSwitch(opt.value),
          },
          {
            keybind: { key: "r" },
            title: "refresh",
            onTrigger: (opt) => handleRefresh(opt.value),
          },
          {
            keybind: { key: "d" },
            title: "delete",
            onTrigger: (opt) => handleDelete(opt.value),
          },
        ]}
      />
    </box>
  )
}

function DialogAccountDetail(props: { account: Account.Entry; onBack: () => void; onRefetch: () => void }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const account = props.account

  const quotaColor = (pct: number) => {
    const color = Account.getQuotaColor(pct)
    if (color === "success") return theme.success
    if (color === "warning") return theme.warning
    return theme.error
  }

  const handleSwitch = async () => {
    if (account.isActive) return
    const success = await Account.setActive(account.id)
    if (success) {
      props.onRefetch()
      props.onBack()
    }
  }

  const handleRefresh = async () => {
    await Account.clearRateLimits(account.id)
    props.onRefetch()
    props.onBack()
  }

  const handleDelete = async () => {
    const success = await Account.remove(account.id)
    if (success) {
      props.onRefetch()
      props.onBack()
    }
  }

  return (
    <box flexDirection="column" gap={1} paddingLeft={4} paddingRight={4} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {account.email || "Account Details"}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <box flexDirection="column" gap={0} paddingTop={1}>
        <text>
          <span style={{ fg: theme.textMuted }}>Provider  </span>
          <span style={{ fg: theme.text }}>{account.provider}</span>
        </text>
        <text>
          <span style={{ fg: theme.textMuted }}>Status    </span>
          <span style={{ fg: account.isActive ? theme.accent : account.status === "active" ? theme.success : theme.warning }}>
            {account.isActive ? "Active" : account.status}
          </span>
        </text>
      </box>

      <Show when={account.quotas && account.quotas.length > 0}>
        <box flexDirection="column" gap={0} paddingTop={1}>
          <text fg={theme.textMuted}>Quotas</text>
          <For each={account.quotas}>
            {(quota) => (
              <text>
                <span style={{ fg: theme.text }}>{quota.displayName.padEnd(14)}</span>
                <span style={{ fg: quotaColor(quota.percentage) }}>{Account.createProgressBar(quota.percentage, 10)} {quota.percentage.toString().padStart(3)}%</span>
                <span style={{ fg: theme.textMuted }}> {quota.resetTime ? Account.formatTimeRemaining(quota.resetTime) : ""}</span>
              </text>
            )}
          </For>
        </box>
      </Show>

      <box flexDirection="row" gap={2} paddingTop={1}>
        <Show when={!account.isActive}>
          <text>
            <span style={{ fg: theme.textMuted }}>[</span>
            <span style={{ fg: theme.primary }}>s</span>
            <span style={{ fg: theme.textMuted }}>] switch</span>
          </text>
        </Show>
        <text>
          <span style={{ fg: theme.textMuted }}>[</span>
          <span style={{ fg: theme.primary }}>r</span>
          <span style={{ fg: theme.textMuted }}>] refresh</span>
        </text>
        <text>
          <span style={{ fg: theme.textMuted }}>[</span>
          <span style={{ fg: theme.error }}>d</span>
          <span style={{ fg: theme.textMuted }}>] delete</span>
        </text>
      </box>
    </box>
  )
}
