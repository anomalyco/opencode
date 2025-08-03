import { Stack } from "expo-router"

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="tabs"
        options={{
          animation: "slide_from_bottom",
        }}
      />
      <Stack.Screen
        name="chat/[sessionId]/index"
        options={{
          animation: "slide_from_bottom",
          presentation: "containedModal",
        }}
      />
    </Stack>
  )
}
