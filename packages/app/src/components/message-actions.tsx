import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { usePrompt } from "@/context/prompt"
import { useNavigate } from "@solidjs/router"
import { extractPromptFromParts } from "@/utils/prompt"
import { base64Encode } from "@opencode-ai/util/encode"
import type { TextPart } from "@opencode-ai/sdk/v2/client"
import type { ParentProps } from "solid-js"

interface MessageActionsProps {
  sessionID: string
  messageID: string
}

export function MessageActions(props: ParentProps<MessageActionsProps>) {
  const sync = useSync()
  const sdk = useSDK()
  const prompt = usePrompt()
  const navigate = useNavigate()

  const sessionStatus = () => sync.data.session_status[props.sessionID] ?? { type: "idle" }
  const parts = () => sync.data.part[props.messageID] ?? []

  const handleRevert = async () => {
    const msgParts = parts()
    if (!msgParts.length) return

    if (sessionStatus().type !== "idle") {
      await sdk.client.session.abort({ sessionID: props.sessionID }).catch(() => {})
    }

    await sdk.client.session.revert({ sessionID: props.sessionID, messageID: props.messageID })

    const restored = extractPromptFromParts(msgParts, { directory: sdk.directory })
    prompt.set(restored)
  }

  const handleFork = () => {
    const msgParts = parts()
    if (!msgParts.length) return

    const restored = extractPromptFromParts(msgParts, { directory: sdk.directory })

    sdk.client.session.fork({ sessionID: props.sessionID, messageID: props.messageID }).then((result) => {
      if (!result.data?.id) return
      navigate(`/${base64Encode(sdk.directory)}/session/${result.data.id}`)
      setTimeout(() => {
        prompt.set(restored)
      }, 500)
    })
  }

  const handleCopy = async () => {
    const text = parts()
      .filter((p): p is TextPart => p.type === "text" && !p.synthetic && !p.ignored)
      .map((p) => p.text)
      .join("")

    if (!text) return

    await navigator.clipboard.writeText(text)
  }

  const menuItems = () => [
    {
      label: "Revert",
      description: "undo messages and file changes",
      onClick: handleRevert,
      dataSlot: "message-action-revert",
    },
    {
      label: "Fork",
      description: "create a new session",
      onClick: handleFork,
      dataSlot: "message-action-fork",
    },
    {
      label: "Copy",
      description: "message text to clipboard",
      onClick: handleCopy,
      dataSlot: "message-action-copy",
    },
  ]

  return (
    <ContextMenu>
      <ContextMenu.Trigger as="div" data-component="message-actions" class="group/message-actions">
        <div class="relative">
          {props.children}
          <div
            data-slot="message-actions-trigger"
            class="absolute top-1 right-1 opacity-0 group-hover/message-actions:opacity-100 transition-opacity"
          >
            <DropdownMenu>
              <DropdownMenu.Trigger as={IconButton} icon="dot-grid" variant="ghost" />
              <DropdownMenu.Portal>
                <DropdownMenu.Content>
                  {menuItems().map((item) => (
                    <DropdownMenu.Item onSelect={item.onClick} data-slot={item.dataSlot}>
                      <DropdownMenu.ItemLabel>{item.label}</DropdownMenu.ItemLabel>
                      <DropdownMenu.ItemDescription>{item.description}</DropdownMenu.ItemDescription>
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content data-component="context-menu-content">
          {menuItems().map((item) => (
            <ContextMenu.Item onSelect={item.onClick} data-slot={item.dataSlot}>
              <ContextMenu.ItemLabel>{item.label}</ContextMenu.ItemLabel>
              <ContextMenu.ItemDescription>{item.description}</ContextMenu.ItemDescription>
            </ContextMenu.Item>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )
}
