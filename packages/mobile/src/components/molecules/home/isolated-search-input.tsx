import React, { useState, useCallback, useRef, useEffect } from "react"
import { TextInput } from "react-native"
import { Input, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"

interface IsolatedSearchInputProps {
  onSearch: (query: string) => void
  placeholder?: string
  debounceMs?: number
}

export const IsolatedSearchInput = ({
  onSearch,
  placeholder = "Search sessions...",
  debounceMs = 300,
}: IsolatedSearchInputProps) => {
  const inputRef = useRef<TextInput>(null)
  const [localQuery, setLocalQuery] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Debounced search to prevent parent re-renders on every keystroke
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      onSearch(localQuery)
    }, debounceMs)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [localQuery, onSearch, debounceMs])
  const handleSearchChange = useCallback((query: string) => {
    setLocalQuery(query)
    // Don't call onSearch immediately - let the debounced effect handle it
  }, [])

  const handleClearSearch = useCallback(() => {
    setLocalQuery("")
    // Clear immediately for better UX
    onSearch("")
    // Maintain focus after clearing
    setTimeout(() => {
      inputRef.current?.focus()
    }, 50)
  }, [onSearch])

  return (
    <Input
      ref={inputRef}
      placeholder={placeholder}
      value={localQuery}
      onChangeText={handleSearchChange}
      leftAccessory={
        <Input.Accessory>
          <Icon icon={Feather} name="search" size={16} />
        </Input.Accessory>
      }
      rightAccessory={
        localQuery ? (
          <Input.Accessory onPress={handleClearSearch}>
            <Icon icon={Feather} name="x" size={16} />
          </Input.Accessory>
        ) : undefined
      }
    />
  )
}
