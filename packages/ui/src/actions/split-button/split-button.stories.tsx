import { createEffect, createSignal, Show } from "solid-js"
import { AppIcon } from "@opencode/ui/app-icon"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { SplitButton, SplitButtonAction, SplitButtonMenuTrigger } from "./split-button"

const defaults = { label: "Open", finder: false, actionDisabled: false, menuDisabled: false, open: false }

export default {
  title: "UI/SplitButton",
  id: "ui-split-button",
  component: SplitButton,
  tags: ["autodocs"],
  args: defaults,
  render: (args: typeof defaults) => {
    const [open, setOpen] = createSignal(args.open)

    const [result, setResult] = createSignal("")

    createEffect(() => setOpen(args.open && !args.menuDisabled))

    return (
      <div>
        <SplitButton classList={{ "session-review-v2-open-in-app": args.finder }}>
          <SplitButtonAction
            disabled={args.actionDisabled}
            aria-label={args.finder ? `${args.label} in Finder` : undefined}
            onClick={() => setResult(args.finder ? "Opened in Finder" : "Opened")}
          >
            <Show when={args.finder} fallback={args.label}>
              <AppIcon id="finder" />
            </Show>
          </SplitButtonAction>
          <Menu open={open()} onOpenChange={setOpen} modal={false} gutter={4} placement="bottom-end">
            <Menu.Trigger
              as={SplitButtonMenuTrigger}
              disabled={args.menuDisabled}
              aria-label={args.finder ? "Open options" : "More open options"}
            >
              <Icon name="chevron-down" size="small" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content>
                <Menu.Item onSelect={() => setResult("Opened in new window")}>Open in new window</Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        </SplitButton>
        <output class="block">{result()}</output>
      </div>
    )
  },
}

export const Basic = {}

export const Disabled = { args: { actionDisabled: true, menuDisabled: true } }

export const OpenIn = { args: { finder: true } }
