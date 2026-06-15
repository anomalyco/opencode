import { Popover } from "@opencode-ai/ui/popover"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { createSignal, For, Match, Show, Switch } from "solid-js"
import { usePlatform } from "@/context/platform"
import helpPlaceholder from "@/assets/help/placeholder.png"

const HELP_ITEMS = [
  { label: "Docs", href: "https://opencode.ai/docs" },
  { label: "Contact us...", href: "https://opencode.ai/desktop-feedback" },
  { label: "Discord community", href: "https://discord.com/invite/opencode" },
] as const

const NEWS_ITEMS = [
  { label: "Tabs Navigation" },
  { label: "Colors & Shadows", disabled: true },
  { label: "Try MiniMax M3", disabled: true },
] as const

const triggerClass =
  "size-7 rounded-full bg-background-base shadow-[var(--shadow-lg-border-base)] flex items-center justify-center text-text-base hover:text-text-strong transition-colors"

// TODO: wire to changelog / seen-state when available
const showPopover = () => true

export function HelpButton() {
  if (import.meta.env.VITE_OPENCODE_CHANNEL !== "dev") return null

  const platform = usePlatform()
  const [open, setOpen] = createSignal(showPopover())

  return (
    <div class="fixed bottom-4 right-4 z-50">
      <Switch>
        <Match when={showPopover()}>
          <Popover
            open={open()}
            onOpenChange={setOpen}
            triggerAs="button"
            triggerProps={{
              type: "button",
              "aria-label": "Help",
              class: triggerClass,
            }}
            trigger={<span aria-hidden="true">?</span>}
            class="[&_[data-slot=popover-body]]:p-0 w-[192px] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-[8px]"
            gutter={8}
            placement="top-end"
          >
            <Show when={open()}>
              <div
                class="relative w-[192px] h-[240px] rounded-[8px] bg-v2-background-bg-base p-1 shadow-[var(--v2-elevation-floating)]"
                aria-label="Introducing Tabs. A faster, more intuitive way to work."
              >
                <button
                  type="button"
                  aria-label="Close"
                  class="absolute top-3 right-3 z-10 size-5 flex items-center justify-center rounded-[4px] bg-[rgba(0,0,0,0.4)]"
                  onClick={() => setOpen(false)}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M4.25 11.75L11.75 4.25M11.75 11.75L4.25 4.25" stroke="white" />
                  </svg>
                </button>
                <svg
                  width="184"
                  height="232"
                  viewBox="0 0 184 232"
                  class="block rounded-[4px]"
                  aria-hidden="true"
                >
                  <image href={helpPlaceholder} width="184" height="232" preserveAspectRatio="xMidYMid slice" />
                  <defs>
                    <linearGradient id="help-launch-scrim" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="#000" stop-opacity="0" />
                      <stop offset="100%" stop-color="#000" stop-opacity="1" />
                    </linearGradient>
                  </defs>
                  <rect x="0" y="137" width="184" height="95" fill="url(#help-launch-scrim)" />
                  <text
                    fill="#ffffff"
                    font-family="var(--font-family-sans, Inter, sans-serif)"
                    font-size="13"
                    letter-spacing="-0.04px"
                    style={{ "mix-blend-mode": "difference" }}
                  >
                    <tspan x="12" y="170" font-weight="530">
                      Introducing Tabs
                    </tspan>
                    <tspan x="12" y="194" font-weight="440" fill-opacity="0.65">
                      A faster, more intuitive way to work.
                    </tspan>
                  </text>
                </svg>
              </div>
            </Show>
          </Popover>
        </Match>
        <Match when={!showPopover()}>
          <MenuV2 open={open()} onOpenChange={setOpen} gutter={8} modal={false} placement="top-end">
            <MenuV2.Trigger as="button" type="button" aria-label="Help" class={triggerClass}>
              <span aria-hidden="true">?</span>
            </MenuV2.Trigger>
            <MenuV2.Portal>
              <MenuV2.Content>
                <MenuV2.Group>
                  <MenuV2.GroupLabel>Help</MenuV2.GroupLabel>
                  <For each={HELP_ITEMS}>
                    {(item) => (
                      <MenuV2.Item onSelect={() => platform.openLink(item.href)}>{item.label}</MenuV2.Item>
                    )}
                  </For>
                </MenuV2.Group>
                <MenuV2.Separator />
                <MenuV2.Group>
                  <MenuV2.GroupLabel>News</MenuV2.GroupLabel>
                  <For each={NEWS_ITEMS}>
                    {(item) => <MenuV2.Item disabled={"disabled" in item && item.disabled}>{item.label}</MenuV2.Item>}
                  </For>
                </MenuV2.Group>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </Match>
      </Switch>
    </div>
  )
}
