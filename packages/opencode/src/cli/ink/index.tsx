import { render, Text, Box } from "ink"

const App = () => (
  <Box flexDirection="column">
    <Text color="green">Ink works!</Text>
    <Text dimColor>Testing maxFps option</Text>
  </Box>
)

const instance = render(<App />, {
  maxFps: 30,
})

setTimeout(() => {
  instance.unmount()
  process.exit(0)
}, 2000)
