import { RootProvider } from "@/providers/root-provider"
import { router, Slot } from "expo-router"
import { useEffect } from "react"

function RootLayout() {
  useEffect(() => {
    setTimeout(() => {
      router.navigate("/tabs/home")
    }, 0)
  }, [])
  return (
    <RootProvider>
      <Slot />
    </RootProvider>
  )
}

export default RootLayout
