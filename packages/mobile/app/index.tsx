import { Box, Text } from "@/components/ui/primitives"
import { router } from "expo-router"
import { useEffect } from "react"
import { ActivityIndicator } from "react-native"

export default function Index() {
  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace("/tabs/home")
    }, 1000)

    return () => clearTimeout(timer)
  }, [])

  return (
    <Box flex center background="base">
      <ActivityIndicator size="large" color="#007AFF" />
      <Box mt="sm">
        <Text>Loading...</Text>
      </Box>
    </Box>
  )
}
