/** @jsxImportSource react */
import { useReducer } from "react"
import type { ReactElement } from "react"
import { Box, Text } from "ink"
import { appReducer, initialState } from "./state/reducer"
import { theme } from "./theme"

export const App = () => {
  const [state, dispatch] = useReducer(appReducer, initialState)

  return (
    <Box flexDirection="column">
      {/* Streaming content */}
      {state.streaming.text && (
        <Box>
          <Text>{state.streaming.text}</Text>
        </Box>
      )}

      {/* Input prompt */}
      <Box>
        <Text color={theme.prompt.agent}>{state.session.agent}</Text>
        <Text color={theme.prompt.separator}> {theme.prompt.symbol} </Text>
      </Box>
    </Box>
  )
}

export default App
