import "@opencode-ai/ui/styles"

import addonA11y from "@storybook/addon-a11y"
import addonDocs from "@storybook/addon-docs"
import { MetaProvider } from "@solidjs/meta"
import { createJSXDecorator, definePreview } from "storybook-solidjs-vite"
import { Code } from "@opencode-ai/ui/code"
import { CodeComponentProvider } from "@opencode-ai/ui/context/code"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { DiffComponentProvider } from "@opencode-ai/ui/context/diff"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { Diff } from "@opencode-ai/ui/diff"
import { ThemeProvider } from "@opencode-ai/ui/theme"
import { Font } from "@opencode-ai/ui/font"

const frame = createJSXDecorator((Story) => {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider>
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
