import { createResource, createMemo } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { useTheme } from "@tui/context/theme"
import type { ExperimentalConsoleListOrgsResponse } from "@opencode-ai/sdk/v2"

type OrgOption = ExperimentalConsoleListOrgsResponse["orgs"][number]

const accountHost = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const accountLabel = (item: Pick<OrgOption, "accountEmail" | "accountUrl">) =>
  `${item.accountEmail}  ${accountHost(item.accountUrl)}`

export function DialogConsoleOrg() {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()

  const [orgs] = createResource(async () => {
    const result = await sdk.client.experimental.console.listOrgs({}, { throwOnError: true })
    return result.data?.orgs ?? []
  })

  const current = createMemo(() => orgs()?.find((item) => item.active))

  const options = createMemo(() => {
    const listed = orgs()
    if (listed === undefined) {
      return [
        {
          title: "Loading orgs...",
          value: "loading",
          onSelect: () => {},
        },
      ]
    }

    if (listed.length === 0) {
      return [
        {
          title: "No orgs found",
          value: "empty",
          onSelect: () => {},
        },
      ]
    }

    return listed
      .toSorted((a, b) => {
        const activeAccountA = a.active ? 0 : 1
        const activeAccountB = b.active ? 0 : 1
        if (activeAccountA !== activeAccountB) return activeAccountA - activeAccountB

        const accountCompare = accountLabel(a).localeCompare(accountLabel(b))
        if (accountCompare !== 0) return accountCompare

        return a.orgName.localeCompare(b.orgName)
      })
      .map((item) => ({
        title: item.orgName,
        value: item,
        category: accountLabel(item),
        categoryView: (
          <box flexDirection="row" gap={2}>
            <text fg={theme.accent}>{item.accountEmail}</text>
            <text fg={theme.textMuted}>{accountHost(item.accountUrl)}</text>
          </box>
        ),
        onSelect: async () => {
          if (item.active) {
            dialog.clear()
            return
          }

          await sdk.client.experimental.console.switchOrg(
            {
              accountID: item.accountID,
              orgID: item.orgID,
            },
            { throwOnError: true },
          )

          await sdk.client.instance.dispose()
          toast.show({
            message: `Switched to ${item.orgName}`,
            variant: "info",
          })
          dialog.clear()
        },
      }))
  })

  return <DialogSelect<string | OrgOption> title="Switch org" options={options()} current={current()} />
}
