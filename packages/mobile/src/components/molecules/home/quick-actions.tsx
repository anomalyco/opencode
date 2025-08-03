import { useState } from "react"
import { Box, Text, Button, Input, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"

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

      <Button mode="brand" onPress={onNewSession}>
        <Button.Icon>
          <Icon icon={Feather} name="plus" size={20} />
        </Button.Icon>
        <Button.Text size="md" weight="medium">
          New Session
        </Button.Text>
      </Button>

      <Input
        placeholder="Search files, symbols, or content..."
        value={searchQuery}
        onChangeText={setSearchQuery}
        onSubmitEditing={handleSearch}
        leftAccessory={
          <Input.Accessory>
            <Icon icon={Feather} name="search" size={16} />
          </Input.Accessory>
        }
        rightAccessory={
          searchQuery ? (
            <Input.Accessory onPress={() => setSearchQuery("")}>
              <Icon icon={Feather} name="x" size={16} />
            </Input.Accessory>
          ) : undefined
        }
      />
    </Box>
  )
}
