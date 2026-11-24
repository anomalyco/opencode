import "../../app/src/index.css"

import { createResource, Show, type Component, type JSX } from "solid-js"
import { Dynamic, render } from "solid-js/web"
import type { ColorScheme } from "@opencode/ui/theme"
import { findStory } from "virtual:story-index"
import { PluginStory } from "./plugin"
import { StoryProviders } from "./providers"

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
    <StoryProviders scheme={props.scheme} direction={globals.direction} locale={globals.locale}>
      <div
        style={{
          // The wrapper fits inside the page's 1rem padding so scrolling a locator into view doesn't shift the story.
          "min-height": props.fullscreen ? "100vh" : "calc(100vh - 2rem)",
          padding: props.fullscreen ? "0" : "24px",
          "background-color": "var(--background-base)",
          color: "var(--text-base)",
        }}
      >
        <PluginStory file={props.file}>{props.children}</PluginStory>
      </div>
    </StoryProviders>
  )
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
