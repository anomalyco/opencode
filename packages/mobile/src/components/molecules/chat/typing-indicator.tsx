import { memo } from "react"
import { Box } from "@/components/ui/primitives"

interface TypingIndicatorProps {
  isVisible: boolean
}

export const TypingIndicator = memo(({ isVisible }: TypingIndicatorProps) => {
  if (!isVisible) return null

  return (
    <Box p="md" style={{ transform: [{ scaleY: -1 }] }}>
      <Box direction="row" justifyContent="flex-start">
        <Box
          background="lightest"
          rounded="xl"
          p="md"
          style={{
            maxWidth: "80%",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05,
            shadowRadius: 2,
            elevation: 1,
          }}
        >
          <Box direction="row" alignItems="center" gap="xs">
            <Box animation="pulse" animationConfig={{ repeat: -1 }}>
              <Box background="emphasis" rounded="full" style={{ width: 8, height: 8 }} />
            </Box>
            <Box animation="pulse" animationConfig={{ repeat: -1, delay: 200 }}>
              <Box background="emphasis" rounded="full" style={{ width: 8, height: 8 }} />
            </Box>
            <Box animation="pulse" animationConfig={{ repeat: -1, delay: 400 }}>
              <Box background="emphasis" rounded="full" style={{ width: 8, height: 8 }} />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  )
})

TypingIndicator.displayName = "TypingIndicator"
