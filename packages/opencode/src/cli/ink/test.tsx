/** @jsxImportSource react */
import { render, Text, Box } from "ink"

const App = () => (
  <Box flexDirection="column">
    <Text color="green">Ink works with React 19!</Text>
    <Text dimColor>Testing maxFps option</Text>
  </Box>
)

if (import.meta.main) {
  const instance = render(<App />, {
    maxFps: 30,
  })

  setTimeout(() => instance.unmount(), 2000)
}
