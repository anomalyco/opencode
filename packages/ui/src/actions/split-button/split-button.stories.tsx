import { Icon } from "@opencode-ai/ui/icon"
import { AppIcon } from "@opencode-ai/ui/app-icon"
import { SplitButton, SplitButtonAction, SplitButtonMenuTrigger } from "./split-button"

export default {
  title: "UI/SplitButton",
  id: "ui-split-button",
  component: SplitButton,
  tags: ["autodocs"],
}

export const Basic = {
  render: () => (
    <SplitButton>
      <SplitButtonAction>Open</SplitButtonAction>
      <SplitButtonMenuTrigger aria-label="More open options">
        <Icon name="chevron-down" size="small" />
      </SplitButtonMenuTrigger>
    </SplitButton>
  ),
}

export const Disabled = {
  render: () => (
    <SplitButton>
      <SplitButtonAction disabled>Open</SplitButtonAction>
      <SplitButtonMenuTrigger disabled aria-label="More open options">
        <Icon name="chevron-down" size="small" />
      </SplitButtonMenuTrigger>
    </SplitButton>
  ),
}

export const OpenIn = {
  render: () => (
    <SplitButton class="session-review-v2-open-in-app">
      <SplitButtonAction aria-label="Open in Finder">
        <AppIcon id="finder" />
      </SplitButtonAction>
      <SplitButtonMenuTrigger aria-label="Open options">
        <Icon name="chevron-down" size="small" />
      </SplitButtonMenuTrigger>
    </SplitButton>
  ),
}
