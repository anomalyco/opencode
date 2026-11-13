import { createSignal, For } from "solid-js"
import { Button } from "@opencode/ui/button"
import { MenuScroll } from "./menu-scroll"

const branches = [
  "main",
  "dev",
  "release",
  "docs",
  "file-search",
  "settings",
  "theme-picker",
  "history",
  "keyboard",
  "mobile",
  "accessibility",
  "preview",
]

const args = { rows: branches.length, height: 144, rtl: false }

function Preview(props: typeof args) {
  const [branch, setBranch] = createSignal("main")

  return (
    <div class="grid w-64 max-w-full gap-2 text-sm">
      <div class="font-medium">Switch branch</div>
      <div dir={props.rtl ? "rtl" : undefined}>
        <MenuScroll
          role="group"
          aria-label="Branches"
          style={{ "max-height": `${props.height}px` }}
          class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01"
          viewportClass="p-1"
        >
          <For each={branches.slice(0, props.rows)}>
            {(name) => (
              <Button
                variant="ghost"
                class="w-full !justify-start"
                aria-pressed={branch() === name}
                onClick={() => setBranch(name)}
              >
                <bdi>{name}</bdi>
              </Button>
            )}
          </For>
        </MenuScroll>
      </div>
      <output class="text-xs text-v2-text-text-muted">
        Current branch: <bdi>{branch()}</bdi>
      </output>
      <p class="text-xs text-v2-text-text-muted">Tab through branches or swipe the list on a touch device.</p>
    </div>
  )
}

export default {
  title: "UI/MenuScroll",
  id: "ui-menu-scroll",
  component: Preview,
  args,
  argTypes: {
    rows: { control: { type: "range", min: 1, max: branches.length, step: 1 } },
    height: { control: { type: "range", min: 80, max: 320, step: 8 } },
  },
}

export const Overflow = {}

export const Fits = { args: { rows: 3 } }

export const RightToLeft = { args: { rtl: true } }
