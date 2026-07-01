import type { ParentProps } from "solid-js"
import { TerminalProvider } from "@/context/terminal"
import { FileProvider } from "@/context/file"
import { PromptProvider } from "@/context/prompt"
import { CommentsProvider } from "@/context/comments"

/**
 * Per-session-view context stack. Wraps a single session Page so its
 * useTerminal/useFile/usePrompt/useComments resolve. The session grid wraps
 * EACH cell in its own SessionProviders so parallel sessions get independent
 * state. Lives in its own module (not app.tsx) to avoid an app<->grid import
 * cycle.
 */
export function SessionProviders(props: ParentProps) {
  return (
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>{props.children}</CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}
