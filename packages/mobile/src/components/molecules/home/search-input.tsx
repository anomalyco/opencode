import React, { useState, useCallback, useRef, forwardRef, useImperativeHandle } from "react"
import { TextInput } from "react-native"
import { Input, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"

interface SearchInputProps {
  onSearch: (query: string) => void
  placeholder?: string
}

export interface SearchInputRef {
  clear: () => void
  getValue: () => string
}

export const SearchInput = forwardRef<SearchInputRef, SearchInputProps>(function SearchInput(
  { onSearch, placeholder = "Search sessions..." },
  ref,
) {
  const inputRef = useRef<TextInput>(null)
  const [searchQuery, setSearchQuery] = useState("")

  useImperativeHandle(
    ref,
    () => ({
      clear: () => {
        setSearchQuery("")
        onSearch("")
        setTimeout(() => {
          inputRef.current?.focus()
        }, 50)
      },
      getValue: () => searchQuery,
    }),
    [searchQuery, onSearch],
  )

  const handleSearchChange = useCallback(
    (query: string) => {
      setSearchQuery(query)
      onSearch(query)
    },
    [onSearch],
  )

  const handleClearSearch = useCallback(() => {
    setSearchQuery("")
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
      value={searchQuery}
      onChangeText={handleSearchChange}
      leftAccessory={
        <Input.Accessory>
          <Icon icon={Feather} name="search" size={16} />
        </Input.Accessory>
      }
      rightAccessory={
        searchQuery ? (
          <Input.Accessory onPress={handleClearSearch}>
            <Icon icon={Feather} name="x" size={16} />
          </Input.Accessory>
        ) : undefined
      }
    />
  )
})
