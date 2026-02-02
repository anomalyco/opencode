/** @jsxImportSource react */
import { useState, useCallback } from "react"
import { Box, Text } from "ink"
import TextInput from "ink-text-input"
import { theme } from "../theme"

interface InputLineProps {
  onSubmit: (value: string) => void
  prompt?: string
  placeholder?: string
  initialValue?: string
  disabled?: boolean
  focus?: boolean
}

export const InputLine = ({
  onSubmit,
  prompt,
  placeholder = "",
  initialValue = "",
  disabled = false,
  focus = true,
}: InputLineProps) => {
  const [value, setValue] = useState(initialValue)

  const handleSubmit = useCallback(
    (text: string) => {
      onSubmit(text)
      setValue("")
    },
    [onSubmit],
  )

  const displayPrompt = prompt ?? `${theme.prompt.symbol} `

  return (
    <Box>
      <Text color={theme.prompt.agent}>{displayPrompt}</Text>
      {disabled ? (
        <Text dimColor>{value || placeholder}</Text>
      ) : (
        <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} placeholder={placeholder} focus={focus} />
      )}
    </Box>
  )
}
