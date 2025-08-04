import { forwardRef } from "react"
import { View, Text } from "react-native"
import { BottomSheetTextInput } from "@gorhom/bottom-sheet"
import type { TextInputProps } from "react-native"
import { useUnistyles } from "react-native-unistyles"

interface BottomSheetInputProps extends TextInputProps {
  label?: string
  leftAccessory?: React.ReactNode
}

export const BottomSheetInput = forwardRef<any, BottomSheetInputProps>(
  ({ label, leftAccessory, style, ...props }, ref) => {
    const { theme } = useUnistyles()

    return (
      <View style={{ gap: theme.spacing.xs }}>
        {label && (
          <Text
            style={{
              fontSize: 14,
              fontWeight: "500",
              color: theme.colors.text.default,
            }}
          >
            {label}
          </Text>
        )}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: theme.colors.background.subtle,
            borderColor: theme.colors.border.subtle,
            borderWidth: 1,
            borderRadius: theme.radius.md,
            minHeight: 44,
          }}
        >
          {leftAccessory && (
            <View
              style={{
                paddingLeft: theme.spacing.md,
                justifyContent: "center",
              }}
            >
              {leftAccessory}
            </View>
          )}
          <BottomSheetTextInput
            ref={ref}
            style={[
              {
                flex: 1,
                paddingHorizontal: leftAccessory ? theme.spacing.sm : theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                fontSize: 16,
                color: theme.colors.text.default,
                minHeight: 44,
              },
              style,
            ]}
            placeholderTextColor={theme.colors.text.subtle}
            {...props}
          />
        </View>
      </View>
    )
  },
)

BottomSheetInput.displayName = "BottomSheetInput"
