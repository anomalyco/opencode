import { useState } from "react"
import { Box, Text, Button, Input } from "@/components/ui/primitives"

interface QuickActionsProps {
  onNewSession: () => void
  onSearch: (query: string) => void
}

export const QuickActions = ({ onNewSession, onSearch }: QuickActionsProps) => {
  const [searchQuery, setSearchQuery] = useState("")

  const handleSearch = () => {
    if (searchQuery.trim()) {
      onSearch(searchQuery.trim())
    }
  }

  return (
    <Box gap="md">
      <Text size="md" weight="semibold">
        Quick Actions
      </Text>

      <Button size="auto" onPress={onNewSession}>
        <Box direction="row" alignItems="center" gap="xs" p="sm" rounded="full">
          <Text size="md" weight="medium" inverse>
            New Session
          </Text>
        </Box>
      </Button>

      <Input
        placeholder="Search files, symbols, or content..."
        value={searchQuery}
        onChangeText={setSearchQuery}
        onSubmitEditing={handleSearch}
        leftAccessory={
          <Input.Accessory>
            <Text>🔍</Text>
          </Input.Accessory>
        }
        rightAccessory={
          searchQuery ? (
            <Input.Accessory onPress={() => setSearchQuery("")}>
              <Text>✕</Text>
            </Input.Accessory>
          ) : undefined
        }
      />
    </Box>
  )
}
