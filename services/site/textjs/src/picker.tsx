import { Box, renderToConsole, Select, Text, useInput, type SelectOption } from "@textjs/react"

// opencode.install.pick(): the install commands and desktop builds as a Text.js list in the
// DevTools console. The site passes the options, so this bundle holds no site data.

type Input = { options: SelectOption<string>[]; selected?: string; dark: boolean }

export function pick(input: Input) {
  return new Promise<string | undefined>((resolve) => {
    const done = (value?: string) => {
      root.then((app) => app.unmount())
      resolve(value)
    }
    const root = renderToConsole(<Picker {...input} onDone={done} />, {
      width: 76,
      height: Math.min(input.options.length, 12) + 6,
      theme: input.dark ? "opencodeDark" : "geistLight",
    })
  })
}

function Picker(props: Input & { onDone: (value?: string) => void }) {
  useInput((event) => {
    if (event.key === "escape") props.onDone()
  })
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>Install OpenCode</Text>
      <Text color="muted">↑ ↓ choose · Enter copies · Esc closes</Text>
      <Box marginTop={1}>
        <Select
          options={props.options}
          value={props.selected}
          limit={12}
          autoFocus
          onChange={(value) => props.onDone(value)}
        />
      </Box>
    </Box>
  )
}
