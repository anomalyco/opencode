import React, { useState, useEffect, useRef } from "react"
import { TextInput, View, TouchableOpacity } from "react-native"
import { Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"

interface WorkingSearchInputProps {
  onSearch?: (query: string) => void
  placeholder?: string
}

export const WorkingSearchInput = ({ onSearch, placeholder = "Search sessions..." }: WorkingSearchInputProps) => {
  const [query, setQuery] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Debounced search to prevent excessive parent re-renders
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
      onSearch("") // Clear immediately for better UX
    }
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderWidth: 1,
        borderColor: "#e0e0e0",
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: "#f8f9fa",
        minHeight: 44,
      }}
    >
      <Icon icon={Feather} name="search" size={16} color="#6b7280" style={{ marginRight: 12 }} />
      <TextInput
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        value={query}
        onChangeText={setQuery}
        style={{
          flex: 1,
          fontSize: 16,
          color: "#1f2937",
          fontFamily: "System", // Use system font for better performance
        }}
      />
      {query.length > 0 && (
        <TouchableOpacity
          onPress={handleClear}
          style={{
            marginLeft: 12,
            padding: 4, // Larger touch target
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon icon={Feather} name="x" size={16} color="#6b7280" />
        </TouchableOpacity>
      )}
    </View>
  )
}
