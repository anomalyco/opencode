import BottomTabs from "@/ui/base/bottom-tabs"
import { Tabs } from "expo-router"
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "transparent",
          position: "absolute",
          elevation: 0,
          borderTopWidth: 0,
        },
      }}
      tabBar={(props) => {
        return <BottomTabs {...props} />
      }}
    >
      <Tabs.Screen
        name="home/index"
        options={{
          title: "Home",
        }}
      />
      <Tabs.Screen
        name="settings/index"
        options={{
          title: "Requests",
        }}
      />
    </Tabs>
  )
}
