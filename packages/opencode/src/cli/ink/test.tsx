/** @jsxImportSource react */
import { render, Text, Box } from "ink"

const App = () => (
  <Box flexDirection="column">
    <Text color="green">Ink is running with React 19!</Text>
    <Text dimColor>Run with: bun --no-plugins src/cli/ink/test.tsx</Text>
  </Box>
)

if (import.meta.main) {
  const instance = render(<App />, { maxFps: 30 })
  setTimeout(() => instance.unmount(), 2000)
}
