import React, { useState, useEffect, useRef } from "react"
import { TextInput, View, TouchableOpacity } from "react-native"
import { Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"

interface TestSearchInputProps {
  onSearch?: (query: string) => void
}

export const TestSearchInput = ({ onSearch }: TestSearchInputProps) => {
  const [query, setQuery] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (onSearch) {
      debounceRef.current = setTimeout(() => {
        onSearch(query)
      }, 300)
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [query, onSearch])

  const handleClear = () => {
    setQuery("")
    if (onSearch) {
      onSearch("")
    }
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderWidth: 1,
        borderColor: "#ccc",
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: "#f5f5f5",
      }}
    >
      <Icon icon={Feather} name="search" size={16} color="#666" style={{ marginRight: 8 }} />
      <TextInput
        placeholder="Search sessions..."
        value={query}
        onChangeText={setQuery}
        style={{ flex: 1, fontSize: 16 }}
      />
      {query.length > 0 && (
        <TouchableOpacity onPress={handleClear} style={{ marginLeft: 8 }}>
          <Icon icon={Feather} name="x" size={16} color="#666" />
        </TouchableOpacity>
      )}
    </View>
  )
}
