import { createResource, createMemo, createSignal, For, Show } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "../context/theme"
import { Account } from "@/account"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"

export function DialogAccounts() {
  const dialog = useDialog()
  const { theme } = useTheme()

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

  const openDetail = (account: Account.Entry) => {
    dialog.replace(() => (
      <AccountDetailView 
        account={account} 
        onBack={() => dialog.replace(() => <DialogAccounts />)}
        onRefetch={refetch}
        showMessage={showMessage}
      />
    ))
  }

  const options = createMemo((): DialogSelectOption<Account.Entry>[] => {
    const list = accounts() ?? []
    return list.map((account) => ({
      value: account,
      title: account.email || account.accountId || `Account #${(account.index ?? 0) + 1}`,
      category: account.provider,
      footer: getStatusText(account.status, account.isActive),
      onSelect: () => openDetail(account),
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
            keybind: { name: "s", ctrl: true, meta: false, shift: false, leader: false },
            title: "switch",
            onTrigger: (opt) => handleSwitch(opt.value),
          },
          {
            keybind: { name: "r", ctrl: true, meta: false, shift: false, leader: false },
            title: "refresh",
            onTrigger: (opt) => handleRefresh(opt.value),
          },
          {
            keybind: { name: "d", ctrl: true, meta: false, shift: false, leader: false },
            title: "delete",
            onTrigger: (opt) => handleDelete(opt.value),
          },
        ]}
      />
    </box>
  )
}

function AccountDetailView(props: { 
  account: Account.Entry
  onBack: () => void
  onRefetch: () => void
  showMessage: (msg: string) => void
}) {
  const { theme } = useTheme()
  const account = props.account

  const handleSwitch = async () => {
    if (account.isActive) return
    const success = await Account.setActive(account.id)
    if (success) {
      props.showMessage("Switched")
      props.onRefetch()
      props.onBack()
    }
  }

  const handleRefresh = async () => {
    await Account.clearRateLimits(account.id)
    props.showMessage("Cleared limits")
    props.onRefetch()
    props.onBack()
  }

  const handleDelete = async () => {
    const success = await Account.remove(account.id)
    if (success) {
      props.showMessage("Removed")
      props.onRefetch()
      props.onBack()
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "b" || evt.name === "q") {
      evt.preventDefault()
      props.onBack()
    }
    if (evt.name === "s" && !account.isActive) {
      evt.preventDefault()
      handleSwitch()
    }
    if (evt.name === "r") {
      evt.preventDefault()
      handleRefresh()
    }
    if (evt.name === "d") {
      evt.preventDefault()
      handleDelete()
    }
  })

  return (
    <box flexDirection="column" gap={1} paddingLeft={4} paddingRight={4} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {account.email || "Account Details"}
        </text>
        <text fg={theme.textMuted}>[b/q] back</text>
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
            {(quota) => {
              const bar = Account.createProgressBar(quota.percentage, 10)
              const colorType = Account.getQuotaColor(quota.percentage)
              const color = colorType === "success" ? theme.success : colorType === "warning" ? theme.warning : theme.error
              const timeStr = quota.percentage >= 100 ? "Ready" : Account.formatTimeRemaining(quota.resetTime)
              return (
                <text>
                  <span style={{ fg: theme.text }}>{quota.displayName.padEnd(14)}</span>
                  <span style={{ fg: color }}>{bar}</span>
                  <span style={{ fg: theme.textMuted }}> {String(quota.percentage).padStart(3)}%  </span>
                  <span style={{ fg: color }}>{timeStr}</span>
                </text>
              )
            }}
          </For>
        </box>
      </Show>

      <box flexDirection="row" gap={2} paddingTop={1}>
        <text>
          <span style={{ fg: theme.textMuted }}>[</span>
          <span style={{ fg: theme.primary }}>b</span>
          <span style={{ fg: theme.textMuted }}>] back</span>
        </text>
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
