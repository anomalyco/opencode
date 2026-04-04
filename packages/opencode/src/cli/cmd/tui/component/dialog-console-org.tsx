import { createResource, createMemo } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"

type OrgOption = {
  accountID: string
  accountEmail: string
  accountUrl: string
  orgID: string
  orgName: string
  active: boolean
}

export function DialogConsoleOrg() {
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()

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
        if (a.active !== b.active) return a.active ? -1 : 1
        return a.orgName.localeCompare(b.orgName)
      })
      .map((item) => ({
        title: item.orgName,
        value: item,
        description: `${item.accountEmail} · ${(() => {
          try {
            return new URL(item.accountUrl).host
          } catch {
            return item.accountUrl
          }
        })()}`,
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
