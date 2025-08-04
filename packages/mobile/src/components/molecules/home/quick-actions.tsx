import React from "react"
import { Box, Text, Button, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"

interface QuickActionsProps {
  onNewSession: () => void
  isCreatingSession?: boolean
}

export const QuickActions = function QuickActions({ onNewSession, isCreatingSession }: QuickActionsProps) {
  return (
    <Box gap="md">
      <Text size="md" weight="semibold">
        Quick Actions
      </Text>

      <Button mode="brand" onPress={onNewSession} loading={isCreatingSession}>
        <Button.Icon>
          <Icon icon={Feather} name="plus" size={20} />
        </Button.Icon>
        <Button.Text size="md" weight="medium">
          New Session
        </Button.Text>
      </Button>
    </Box>
  )
}
