import { useState } from "react"
import { SectionList } from "react-native"
import { Box, Text, Button } from "@/components/ui/primitives"
import { useTheme } from "@/providers/theme-context"
import { useSetUserSettingsMutation } from "@/services/api/local/user-settings"
import { useClearLocalFileCacheMutation } from "@/services/api/local/files"
import { useDeleteProjectMutation, useProjectsQuery } from "@/services/api/local/projects"
import { useSonner } from "@/hooks/use-sonner"
import { useQueryClient } from "@tanstack/react-query"
import db from "@/db"
import * as Application from "expo-application"

type SettingItemType = "switch" | "action"

type SettingItem = {
  id: string
  title: string
  subtitle?: string
  iconName: string
  type: SettingItemType
  onPress?: () => void
  value?: boolean
  onToggle?: (value: boolean) => void
  destructive?: boolean
}

type SettingSection = {
  id: string
  title: string
  items: SettingItem[]
}

export default function SettingsPage() {
  const { currentTheme, changeTheme } = useTheme()
  const setUserSettings = useSetUserSettingsMutation()
  const clearFileCache = useClearLocalFileCacheMutation()
  const deleteProject = useDeleteProjectMutation()
  const { data: projects } = useProjectsQuery()
  const queryClient = useQueryClient()
  const sonner = useSonner()

  const [resetConfirmCount, setResetConfirmCount] = useState(0)

  const isDarkMode = currentTheme === "dark"

  const toggleTheme = async () => {
    const newTheme = isDarkMode ? "light" : "dark"
    try {
      await changeTheme(newTheme)
      await setUserSettings.mutateAsync({ theme: newTheme })
      sonner.success(`Switched to ${newTheme} mode`)
    } catch (error) {
      sonner.error("Failed to change theme")
    }
  }

  const handleResetApp = async () => {
    if (resetConfirmCount === 0) {
      setResetConfirmCount(1)
      sonner.warning("Tap again to reset app and clear all data", {
        duration: 5000,
        persistent: true,
      })
      // Reset after 5 seconds
      setTimeout(() => setResetConfirmCount(0), 5000)
    } else {
      sonner.loading("Resetting app...")

      try {
        // Clear all projects
        if (projects) {
          for (const project of projects) {
            await deleteProject.mutateAsync(project.id)
          }
        }

        // Clear file cache
        await clearFileCache.mutateAsync()

        // Clear all database tables
        const { sessions, messages, messageParts, fileCache, providers, syncQueue } = await import("@/db/schema")
        await db.delete(sessions)
        await db.delete(messages)
        await db.delete(messageParts)
        await db.delete(fileCache)
        await db.delete(providers)
        await db.delete(syncQueue)

        // Clear all TanStack Query cache
        queryClient.clear()

        // Reset user settings to defaults
        await setUserSettings.mutateAsync({
          theme: "system",
          currentMode: "build",
          notificationsEnabled: true,
          hapticsEnabled: true,
          autoSync: true,
          cacheSizeLimit: 104857600, // 100MB
        })

        setResetConfirmCount(0)

        // Clear all toasts (including persistent warning toasts) and show success
        sonner.clear()
        sonner.success("App reset successfully! All data cleared.")
      } catch (error) {
        // Clear all toasts and show error
        sonner.clear()
        sonner.error(`Failed to reset app: ${error instanceof Error ? error.message : "Unknown error"}`)
      }
    }
  }

  const settingsSections: SettingSection[] = [
    {
      id: "app",
      title: "App Settings",
      items: [
        {
          id: "theme",
          title: "Dark Mode",
          subtitle: `Currently using ${currentTheme} theme`,
          iconName: isDarkMode ? "🌙" : "☀️",
          type: "switch",
          value: isDarkMode,
          onToggle: toggleTheme,
          onPress: toggleTheme,
        },
      ],
    },
    {
      id: "about",
      title: "About",
      items: [
        {
          id: "version",
          title: "Version",
          subtitle: `${Application.applicationName} v${Application.nativeApplicationVersion} (${Application.nativeBuildVersion})`,
          iconName: "ℹ️",
          type: "action",
        },
      ],
    },
    {
      id: "data",
      title: "Data Management",
      items: [
        {
          id: "clearCache",
          title: "Clear File Cache",
          subtitle: "Clear cached files to free up space",
          iconName: "🗑️",
          type: "action",
          onPress: async () => {
            try {
              await clearFileCache.mutateAsync()
              sonner.success("File cache cleared successfully")
            } catch (error) {
              sonner.error("Failed to clear file cache")
            }
          },
        },
      ],
    },
    {
      id: "danger",
      title: "Danger Zone",
      items: [
        {
          id: "reset",
          title: "Reset App",
          subtitle:
            resetConfirmCount > 0
              ? "⚠️ Tap again to confirm - This will delete ALL data!"
              : "Clear all data and reset to defaults",
          iconName: "⚠️",
          type: "action",
          destructive: true,
          onPress: handleResetApp,
        },
      ],
    },
  ]

  const renderSettingItem = (item: SettingItem) => {
    return (
      <Button
        key={item.id}
        variant="ghost"
        size="auto"
        onPress={item.onPress}
        style={{
          paddingHorizontal: 0,
          paddingVertical: 12,
          justifyContent: "flex-start",
          height: "auto",
        }}
      >
        <Box
          style={{
            flexDirection: "row",
            alignItems: "center",
            width: "100%",
            paddingHorizontal: 16,
          }}
        >
          {/* Icon */}
          <Box
            background="subtle"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              marginRight: 12,
            }}
          >
            <Text size="lg">{item.iconName}</Text>
          </Box>

          {/* Content */}
          <Box style={{ flex: 1 }}>
            <Text size="md" weight="medium" mode={item.destructive ? "error" : undefined}>
              {item.title}
            </Text>
            {item.subtitle && (
              <Text size="sm" mode="subtle" style={{ marginTop: 2 }}>
                {item.subtitle}
              </Text>
            )}
          </Box>

          {/* Right Element */}
          <Box style={{ marginLeft: 12 }}>
            {item.type === "switch" && (
              <Button
                variant={item.value ? "outline" : "ghost"}
                size="sm"
                onPress={() => item.onToggle?.(!item.value)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  backgroundColor: item.value ? "#007AFF" : "transparent",
                }}
              >
                <Text size="xs" weight="medium" style={{ color: item.value ? "white" : undefined }}>
                  {item.value ? "ON" : "OFF"}
                </Text>
              </Button>
            )}
          </Box>
        </Box>
      </Button>
    )
  }

  const renderSectionHeader = ({ section }: { section: SettingSection & { data: SettingItem[] } }) => (
    <Box style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8 }}>
      <Text
        size="sm"
        weight="semibold"
        mode="subtle"
        style={{
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {section.title}
      </Text>
    </Box>
  )

  const renderItem = ({
    item,
    index,
    section,
  }: {
    item: SettingItem
    index: number
    section: SettingSection & { data: SettingItem[] }
  }) => (
    <Box
      background="lightest"
      style={{
        marginHorizontal: 16,
        borderTopLeftRadius: index === 0 ? 12 : 0,
        borderTopRightRadius: index === 0 ? 12 : 0,
        borderBottomLeftRadius: index === section.data.length - 1 ? 12 : 0,
        borderBottomRightRadius: index === section.data.length - 1 ? 12 : 0,
        overflow: "hidden",
      }}
    >
      {renderSettingItem(item)}
      {index < section.data.length - 1 && (
        <Box
          background="subtle"
          style={{
            height: 1,
            marginLeft: 68,
          }}
        />
      )}
    </Box>
  )

  const renderListHeader = () => (
    <Box style={{ alignItems: "center", paddingVertical: 32 }}>
      <Box
        center
        background="subtle"
        mb="md"
        rounded="lg"
        style={{
          width: 80,
          height: 80,
        }}
      >
        <Text size="xl">⚙️</Text>
      </Box>
      <Text size="xl" weight="bold">
        Settings
      </Text>
      <Text size="sm" mode="subtle" style={{ marginTop: 4 }}>
        Manage your app preferences
      </Text>
    </Box>
  )

  const renderListFooter = () => <Box style={{ height: 100 }} />

  return (
    <Box flex background="base" safeAreaTop>
      <SectionList
        sections={settingsSections.map((section) => ({
          ...section,
          data: section.items,
        }))}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        ListHeaderComponent={renderListHeader}
        ListFooterComponent={renderListFooter}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
      />
    </Box>
  )
}
