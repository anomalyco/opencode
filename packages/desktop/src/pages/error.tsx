import { TextField } from "@opencode-ai/ui/text-field"
import { Logo } from "@opencode-ai/ui/logo"
import { Component } from "solid-js"
import { usePlatform } from "@/context/platform"
import { Icon } from "@opencode-ai/ui/icon"

interface ErrorPageProps {
  error: any
}

export const ErrorPage: Component<ErrorPageProps> = (props) => {
  const platform = usePlatform()
  return (
    <div class="relative flex-1 h-screen w-screen min-h-0 flex flex-col items-center justify-center">
      <div class="w-2/3 max-w-3xl flex flex-col items-center justify-center gap-8">
        <Logo class="h-8 w-auto text-text-strong" />
        <div class="flex flex-col items-center gap-2 text-center">
          <h1 class="text-lg font-medium text-text-strong">Something went wrong</h1>
          <p class="text-sm text-text-weak">An error occurred while loading the application.</p>
        </div>
        <TextField
          value={String(props.error?.data?.message || props.error?.message || props.error)}
          readOnly
          copyable
          multiline
          class="max-h-96 w-full font-mono text-xs no-scrollbar whitespace-pre"
          label="Error Details"
          hideLabel
        />
        <div class="flex items-center justify-center gap-1">
          Please report this error to the OpenCode team
          <button
            type="button"
            class="flex items-center text-text-interactive-base gap-1"
            onClick={() => platform.openLink("https://opencode.ai/desktop-feedback")}
          >
            <div>on Discord</div>
            <Icon name="discord" class="text-text-interactive-base" />
          </button>
        </div>
      </div>
    </div>
  )
}
