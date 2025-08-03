import { UpdateNotificationManager } from "@/managers/update-notification-manager"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { KeyboardProvider } from "react-native-keyboard-controller"
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet"

import { QueryProvider } from "./query-provider"
import { DataSyncProvider } from "./data-sync-provider"

import { ThemeContextProvider } from "./theme-context"
import { ThemeProvider } from "./theme-provider"
import { SonnerProvider } from "./sonner-provider"
import { SonnerOverlay } from "@/ui/overlays/sonner-overlay"

export const RootProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeContextProvider>
        <ThemeProvider>
          <SonnerProvider>
            <KeyboardProvider>
              <BottomSheetModalProvider>
                <QueryProvider>
                  <DataSyncProvider>
                    {children}
                    <UpdateNotificationManager />
                    <SonnerOverlay />
                    {/* {__DEV__ && <DevToolbar />} */}
                  </DataSyncProvider>
                </QueryProvider>
              </BottomSheetModalProvider>
            </KeyboardProvider>
          </SonnerProvider>
        </ThemeProvider>
      </ThemeContextProvider>
    </GestureHandlerRootView>
  )
}
