/** @jsxImportSource react */
import { useState, useEffect, useRef } from "react"
import { Box, Text, useInput, useStdin } from "ink"
import { theme } from "../theme"

interface SelectOption {
  label: string
  value: string
}

interface SelectMenuProps {
  options: SelectOption[]
  onSelect: (value: string) => void
  onCancel?: () => void
  title?: string
  isActive?: boolean
}

export const SelectMenu = ({ options, onSelect, onCancel, title, isActive = true }: SelectMenuProps) => {
  const [selected, setSelected] = useState(0)
  const optionsRef = useRef(options)
  const isMounted = useRef(true)
  const { stdin, setRawMode, isRawModeSupported } = useStdin()

  optionsRef.current = options

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  useEffect(() => {
    setSelected(0)
  }, [options.length])

  useEffect(() => {
    if (!isRawModeSupported || !isActive) return

    setRawMode(true)

    return () => {
      setRawMode(false)
    }
  }, [isRawModeSupported, isActive, setRawMode])

  useInput(
    (input, key) => {
      if (!isMounted.current) return

      const currentOptions = optionsRef.current
      if (!currentOptions || currentOptions.length === 0) return

      if (key.upArrow) {
        setSelected((prev) => (prev > 0 ? prev - 1 : currentOptions.length - 1))
      }

      if (key.downArrow) {
        setSelected((prev) => (prev < currentOptions.length - 1 ? prev + 1 : 0))
      }

      if (key.return) {
        const option = currentOptions[selected]
        if (option && isMounted.current) onSelect(option.value)
      }

      if (key.escape && onCancel && isMounted.current) {
        onCancel()
      }
    },
    { isActive },
  )

  if (!options || options.length === 0) {
    return null
  }

  return (
    <Box flexDirection="column">
      {title && <Text color={theme.colors.primary}>{title}</Text>}
      {options.map((option, index) => (
        <Box key={`${option.value}-${index}`}>
          <Text color={index === selected ? theme.colors.primary : undefined}>
            {index === selected ? "❯ " : "  "}
            {option.label}
          </Text>
        </Box>
      ))}
    </Box>
  )
}
