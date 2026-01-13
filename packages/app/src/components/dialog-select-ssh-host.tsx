import { Component, createMemo, Show } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { useSsh, type SshConfigHost } from "@/context/ssh"

export const DialogSelectSshHost: Component<{
  onSelect: (host: string, configHost?: SshConfigHost) => void
}> = (props) => {
  const dialog = useDialog()
  const ssh = useSsh()

  const configHosts = createMemo(() => ssh.configHosts())

  const handleSelect = (host: SshConfigHost | string) => {
    if (typeof host === "string") {
      props.onSelect(host)
    } else {
      const hostString = host.user ? `${host.user}@${host.host}` : host.host
      props.onSelect(hostString, host)
    }
    dialog.close()
  }

  return (
    <Dialog title="Select configured SSH host or enter user@host">
      <div class="flex flex-col gap-4 pb-4">
        <List
          search={{ placeholder: "e.g. ubuntu@ec2-3-106-99.amazonaws.com, or named host below", autofocus: true }}
          emptyMessage="No SSH hosts found"
          items={configHosts()}
          key={(h) => h.name}
          onSelect={(host) => {
            if (host) {
              handleSelect(host)
            }
          }}
          onKeyEvent={(e, item) => {
            if (e.key === "Enter" && !item) {
              const input = e.target as HTMLInputElement
              const value = input?.value?.trim()
              if (value) {
                e.preventDefault()
                handleSelect(value)
              }
            }
          }}
        >
          {(host) => (
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <span class="truncate">{host.name}</span>
              <Show when={host.user || host.host !== host.name}>
                <span class="text-text-weak text-12-regular">
                  {host.user ? `${host.user}@` : ""}
                  {host.host !== host.name ? host.host : ""}
                </span>
              </Show>
            </div>
          )}
        </List>
      </div>
    </Dialog>
  )
}
