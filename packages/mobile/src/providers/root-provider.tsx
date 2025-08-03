import { UpdateNotificationManager } from "@/managers/update-notification-manager"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { KeyboardProvider } from "react-native-keyboard-controller"

import { QueryProvider } from "./query-provider"

import { ThemeContextProvider } from "./theme-context"
import { ThemeProvider } from "./theme-provider"
import { SonnerProvider } from "./sonner-provider"
import { SonnerOverlay } from "@/ui/overlays/sonner-overlay"

export const RootProvider = ({ children }: { children: React.ReactNode }) => {
  console.log("help")
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeContextProvider>
        <ThemeProvider>
          <SonnerProvider>
            <KeyboardProvider>
              <QueryProvider>
                {children}
                <UpdateNotificationManager />
                <SonnerOverlay />
                {/* {__DEV__ && <DevToolbar />} */}
              </QueryProvider>
            </KeyboardProvider>
          </SonnerProvider>
        </ThemeProvider>
      </ThemeContextProvider>
    </GestureHandlerRootView>
  )
}
