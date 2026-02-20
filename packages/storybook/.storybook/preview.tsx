import "@opencode-ai/ui/styles"

import { createEffect, onCleanup, onMount } from "solid-js"
import addonA11y from "@storybook/addon-a11y"
import addonDocs from "@storybook/addon-docs"
import { MetaProvider } from "@solidjs/meta"
import { addons } from "storybook/preview-api"
import { GLOBALS_UPDATED } from "storybook/internal/core-events"
import { createJSXDecorator, definePreview } from "storybook-solidjs-vite"
import { Code } from "@opencode-ai/ui/code"
import { CodeComponentProvider } from "@opencode-ai/ui/context/code"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { DiffComponentProvider } from "@opencode-ai/ui/context/diff"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { Diff } from "@opencode-ai/ui/diff"
import { ThemeProvider, useTheme, type ColorScheme } from "@opencode-ai/ui/theme"
import { Font } from "@opencode-ai/ui/font"

function resolveScheme(value: unknown): ColorScheme {
  if (value === "light" || value === "dark" || value === "system") return value
  return "system"
}

const channel = addons.getChannel()

const Scheme = (props: { value?: unknown }) => {
  const theme = useTheme()
  const apply = (value?: unknown) => {
    theme.setColorScheme(resolveScheme(value))
  }
  createEffect(() => {
    apply(props.value)
  })
  createEffect(() => {
    const root = document.documentElement
    root.classList.remove("light", "dark")
    root.classList.add(theme.mode())
  })
  onMount(() => {
    const handler = (event: { globals?: Record<string, unknown> }) => {
      apply(event.globals?.theme)
    }
    channel.on(GLOBALS_UPDATED, handler)
    onCleanup(() => channel.off(GLOBALS_UPDATED, handler))
  })
  return null
}

const frame = createJSXDecorator((Story, context) => {
  const override = context.parameters?.themes?.themeOverride
  const selected = context.globals?.theme
  const pick = override === "light" || override === "dark" ? override : selected
  const scheme = resolveScheme(pick)
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider>
        <Scheme value={scheme} />
        <DialogProvider>
          <MarkedProvider>
            <DiffComponentProvider component={Diff}>
              <CodeComponentProvider component={Code}>
                <div
                  style={{
                    "min-height": "100vh",
                    padding: "24px",
                    "background-color": "var(--background-base)",
                    color: "var(--text-base)",
                  }}
                >
                  <Story />
                </div>
              </CodeComponentProvider>
            </DiffComponentProvider>
          </MarkedProvider>
        </DialogProvider>
      </ThemeProvider>
    </MetaProvider>
  )
})

export default definePreview({
  addons: [addonDocs(), addonA11y()],
  decorators: [frame],
  globalTypes: {
    theme: {
      name: "Theme",
      description: "Global theme",
      defaultValue: "light",
    },
  },
  parameters: {
    actions: {
      argTypesRegex: "^on.*",
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: "todo",
    },
  },
})
