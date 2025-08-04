import { RootProvider } from "@/providers/root-provider"
import { Slot } from "expo-router"

function RootLayout() {
  return (
    <RootProvider>
      <Slot />
    </RootProvider>
  )
}

export default RootLayout
