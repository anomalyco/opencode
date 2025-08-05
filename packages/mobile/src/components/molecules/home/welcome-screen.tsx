import React, { memo } from "react"
import { TouchableOpacity } from "react-native"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"

interface WelcomeScreenProps {
  onAddProject: () => void
}

export const WelcomeScreen = memo<WelcomeScreenProps>(({ onAddProject }) => {
  return (
    <Box flex safeAreaTop background="base" center p="lg">
      <Box center gap="lg" style={{ maxWidth: 320 }}>
        {/* Welcome Message */}
        <Box center gap="sm">
          <Text size="lg" weight="bold" style={{ textAlign: "center" }}>
            Hey
          </Text>
          <Text size="md" mode="subtle" style={{ textAlign: "center", lineHeight: 22 }}>
            Connect to your development environment to get started
          </Text>
        </Box>

        {/* CTA Button */}
        <TouchableOpacity onPress={onAddProject} style={{ width: "100%" }}>
          <Box
            center
            p="lg"
            background="emphasis"
            rounded="lg"
            style={{
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1,
              shadowRadius: 4,
              elevation: 3,
            }}
          >
            <Box direction="row" alignItems="center" gap="sm">
              <Icon icon={Feather} name="plus" size={20} color="white" />
              <Text size="md" weight="medium" style={{ color: "white" }}>
                Connect Project
              </Text>
            </Box>
          </Box>
        </TouchableOpacity>
      </Box>
    </Box>
  )
})

WelcomeScreen.displayName = "WelcomeScreen"
