import { createEffect, createSignal, For, Show } from "solid-js"
import type { TitlebarItem } from "@opencode/plugin/gui"
import { TitlebarItems } from "./titlebar-items"

type Labels = { "status.label": string; "action.installRestart": string; "action.installing": string }

const catalogs = import.meta.glob<{ default: Labels }>("../../../../gui-plugins/src/updater/i18n/*.ts", { eager: true })

const rtl = new Set(["ar", "dv", "fa", "he", "ur"])

const locales = Object.entries(catalogs)
  .map(([file, module]) => ({
    locale: file.split("/").pop()!.replace(".ts", ""),
    labels: module.default,
  }))
  .sort((a, b) => a.locale.localeCompare(b.locale))

const actions = ["label only", "install", "installing", "toggle off", "toggle on"] as const

type Args = { locale: string; layout: string; action: (typeof actions)[number]; label: string }

export default {
  title: "App/Titlebar/Items",
  id: "app-titlebar-items",
  component: TitlebarItems,
  args: { locale: "all", layout: "both", action: "label only", label: "" },
  argTypes: {
    locale: { options: ["all", ...locales.map((entry) => entry.locale)] },
    layout: { options: ["both", "horizontal", "vertical"] },
    action: { options: actions },
  },
  render: (args: Args) => (
    <div class="flex flex-col gap-1 bg-v2-background-bg-base p-4">
      <For each={locales.filter((entry) => args.locale === "all" || args.locale === entry.locale)}>
        {(entry) => {
          const [action, setAction] = createSignal(args.action)
          createEffect(() => setAction(args.action))

          const toggle = () => action() === "toggle on" || action() === "toggle off"

          const item = (): TitlebarItem => ({
            id: "update",
            label: args.label || entry.labels["status.label"],
            get title() {
              if (action() === "installing") return entry.labels["action.installing"]

              if (action() === "install") return entry.labels["action.installRestart"]
            },
            busy: action() === "installing",
            icon: toggle() ? "terminal" : undefined,
            pressed: toggle() ? action() === "toggle on" : undefined,
            run: () => {
              if (action() === "install") return setAction("installing")

              if (toggle()) setAction(action() === "toggle on" ? "toggle off" : "toggle on")
            },
          })

          const items = { ids: () => ["update"], item }

          return (
            <div data-locale={entry.locale} dir={rtl.has(entry.locale) ? "rtl" : "ltr"} class="flex items-center gap-4">
              <span class="w-10 shrink-0 font-mono text-[11px] text-v2-text-text-weak">{entry.locale}</span>
              <Show when={args.layout !== "vertical"}>
                <div
                  data-slot="story-horizontal"
                  class="flex h-10 w-[320px] shrink-0 items-center justify-end rounded-md bg-v2-background-bg-deep/60"
                >
                  <div class="relative z-20 flex shrink-0 items-center justify-end overflow-visible">
                    <TitlebarItems items={items} />
                  </div>
                </div>
              </Show>
              <Show when={args.layout !== "horizontal"}>
                <div
                  data-slot="story-vertical"
                  class="flex w-[220px] shrink-0 flex-col rounded-md bg-v2-background-bg-deep/60 p-2"
                >
                  <TitlebarItems items={items} vertical />
                </div>
              </Show>
            </div>
          )
        }}
      </For>
    </div>
  ),
}

/** The update pill in every updater locale; hover or focus a pill to expand its label. */
export const UpdateLabels = {}

export const ReadyToInstall = { args: { locale: "en", action: "install", layout: "horizontal" } }

export const Installing = { args: { locale: "en", action: "installing" } }

export const Pressed = { args: { locale: "en", layout: "vertical", action: "toggle on", label: "Terminal" } }
