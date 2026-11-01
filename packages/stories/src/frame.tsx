import "../../app/src/index.css"

import { createEffect, createResource, onCleanup, onMount, Show, type Component, type JSX } from "solid-js"
import { Dynamic, render } from "solid-js/web"
import { MetaProvider } from "@solidjs/meta"
import { DialogProvider } from "@opencode/ui/context/dialog"
import { ThemeProvider, useTheme, type ColorScheme } from "@opencode/ui/theme"
import { Font } from "@opencode/ui/font"
import { LanguageProvider, UiI18nBridge, useLanguage } from "@/runtime/i18n/language"
import { SettingsProvider } from "@/settings/model"
import { findStory } from "virtual:story-index"
import { PluginStory } from "./plugin"

type Args = { [key: string]: unknown }

type StoryObject = {
  args?: Args
  render?: (args: Args) => JSX.Element
  component?: Component<Args>
  parameters?: { layout?: string; themes?: { themeOverride?: string } }
}

// `?id=<story id>&args=key:value;…&globals=theme:dark;direction:rtl`, the query Storybook's iframe took.
const query = new URLSearchParams(location.search)
const globals = pairs(query.get("globals"))
const story = findStory(query.get("id") ?? "")

render(() => <Frame />, document.getElementById("story-root")!)

function Frame() {
  const [module] = createResource(async () => {
    if (!story) throw new Error(`No story has the id "${query.get("id")}"`)

    return { file: story.file, exports: await story.load() }
  })

  return (
    <Show when={module()}>
      {(loaded) => {
        const meta = asStory(loaded().exports.default)
        const own = loaded().exports[story!.name]
        const entry = typeof own === "function" ? { render: own } : asStory(own)
        const defaults = { ...meta.args, ...entry.args }
        const args = { ...defaults, ...coerce(pairs(query.get("args")), defaults) }
        const component = meta.component
        const draw = entry.render ?? meta.render
        const parameters = { ...meta.parameters, ...entry.parameters }
        const override = parameters.themes?.themeOverride
        const fullscreen = parameters.layout === "fullscreen"

        if (!fullscreen) document.body.style.padding = "1rem"

        return (
          <Decorators
            scheme={scheme(override === "light" || override === "dark" ? override : (globals.theme ?? "light"))}
            fullscreen={fullscreen}
            file={loaded().file}
          >
            {draw ? draw(args) : component && <Dynamic component={component} {...args} />}
          </Decorators>
        )
      }}
    </Show>
  )
}

function Decorators(props: { scheme: ColorScheme; fullscreen: boolean; file: string; children: JSX.Element }) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider>
        <LanguageProvider locale={globals.locale ?? "en"}>
          <UiI18nBridge>
            <Scheme value={props.scheme} />
            <Direction value={globals.direction} />
            <Motion />
            <SettingsProvider>
              <DialogProvider>
                <div
                  style={{
                    // Outside fullscreen the page has 1rem of padding around the story. A full-viewport frame inside
                    // it would make every story page scroll by 32px, so an incidental scroll could move the story
                    // under a test.
                    "min-height": props.fullscreen ? "100vh" : "calc(100vh - 2rem)",
                    padding: props.fullscreen ? "0" : "24px",
                    "background-color": "var(--background-base)",
                    color: "var(--text-base)",
                  }}
                >
                  <PluginStory file={props.file}>{props.children}</PluginStory>
                </div>
              </DialogProvider>
            </SettingsProvider>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

function Scheme(props: { value: ColorScheme }) {
  const theme = useTheme()

  createEffect(() => theme.setColorScheme(props.value))
  createEffect(() => {
    document.documentElement.classList.remove("light", "dark")
    document.documentElement.classList.add(theme.mode())
  })

  return null
}

function Direction(props: { value?: string }) {
  const language = useLanguage()

  createEffect(() => language.setDirection(props.value === "rtl" ? "rtl" : "ltr"))

  return null
}

// The app derives this attribute from its reduce motion setting; stories follow the system preference.
function Motion() {
  onMount(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)")

    const apply = () => (document.documentElement.dataset.motion = motion.matches ? "reduce" : "full")

    apply()
    motion.addEventListener("change", apply)
    onCleanup(() => motion.removeEventListener("change", apply))
  })

  return null
}

function scheme(value: string): ColorScheme {
  if (value === "light" || value === "dark" || value === "system") return value

  return "system"
}

function pairs(value: string | null): { [key: string]: string } {
  return Object.fromEntries(
    (value ?? "")
      .split(";")
      .filter(Boolean)
      .map((pair) => [pair.slice(0, pair.indexOf(":")), pair.slice(pair.indexOf(":") + 1)]),
  )
}

// Address values are text; a story's own arg of another type says what they mean, as Storybook's argTypes did.
function coerce(values: { [key: string]: string }, defaults: Args): Args {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const text = value.replace(/^!/, "")

      if (value === "!null") return [key, null]
      if (value === "!undefined") return [key, undefined]
      if (typeof defaults[key] === "boolean" || value.startsWith("!")) return [key, text === "true"]
      if (typeof defaults[key] === "number") return [key, Number(text)]

      return [key, value]
    }),
  )
}

function asStory(value: unknown): StoryObject {
  return value && typeof value === "object" ? value : {}
}
