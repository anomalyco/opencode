import BlurView from "@/components/ui/primitives/blur-view"
import haptics from "@/utils/haptics"
import { Icon, Text } from "@/primitives"
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons"
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs"
import { router } from "expo-router"
import React from "react"
import { Pressable } from "react-native"
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { StyleSheet } from "react-native-unistyles"

const routes = [
  {
    name: "home",
    icon: MaterialCommunityIcons,
    iconName: "circle-multiple-outline",
    iconNameFocused: "circle-multiple",
    label: "Home",
    path: "(app)/tabs/home",
    size: 25,
  },
  {
    name: "settings",
    icon: Ionicons,
    iconName: "settings-outline",
    iconNameFocused: "settings",
    label: "Settings",
    path: "(app)/tabs/settings",
    size: 23,
  },
]

const TabItem = ({
  route,
  isFocused,
  onPress,
}: {
  route: (typeof routes)[0]
  isFocused: boolean
  onPress: () => void
}) => {
  const animatedValue = useSharedValue(isFocused ? 1 : 0)

  // Update animation when focus changes
  React.useEffect(() => {
    animatedValue.value = withTiming(isFocused ? 1 : 0, { duration: 300 })
  }, [isFocused])

  // Animated style for the icon container
  const iconStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          rotate: `${interpolate(animatedValue.value, [0, 1], [0, 360], Extrapolation.CLAMP)}deg`,
        },
        {
          scale: interpolate(animatedValue.value, [0, 1], [1, 1.1], Extrapolation.CLAMP),
        },
      ],
    }
  })

  const handlePress = () => {
    haptics.selection()
    onPress()
  }

  return (
    <Pressable onPress={handlePress} style={styles.tab}>
      <Animated.View style={[styles.iconContainer, iconStyle]}>
        <Icon icon={route.icon} name={isFocused ? route.iconNameFocused : route.iconName} size={route.size} />
      </Animated.View>
      <Text style={styles.label}>{route.label}</Text>
    </Pressable>
  )
}

const BottomTabs = ({ ...props }: BottomTabBarProps) => {
  const { state } = props
  const { index } = state
  const thumbPosition = useSharedValue(index)
  const insets = useSafeAreaInsets()

  // We need to cast the color as a string to fix the type error

  // Update thumb position when active tab changes
  React.useEffect(() => {
    thumbPosition.value = withTiming(index, { duration: 300 })
  }, [index])

  // Animated style for the thumb indicator
  const thumbStyle = useAnimatedStyle(() => {
    const tabWidth = 100 / routes.length
    // Make thumb 30% of tab width
    const thumbWidth = tabWidth * 0.3
    // Calculate left position to center thumb in tab
    const leftPosition = interpolate(
      thumbPosition.value,
      [0, routes.length - 1],
      [
        (tabWidth - thumbWidth) / 2, // First tab center position
        tabWidth * (routes.length - 1) + (tabWidth - thumbWidth) / 2, // Last tab center position
      ],
      Extrapolation.CLAMP,
    )

    return {
      left: `${leftPosition}%`,
      width: `${thumbWidth}%`,
    }
  })

  return (
    <BlurView style={[styles.container, { paddingBottom: insets.bottom }]} intensity={70}>
      <Animated.View style={[styles.thumb, thumbStyle]} />
      {routes.map((route, idx) => (
        <TabItem
          key={route.name}
          route={route}
          isFocused={index === idx}
          onPress={() => router.navigate(route.path as any)}
        />
      ))}
    </BlurView>
  )
}

export default BottomTabs

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 10,
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    zIndex: 1,
  },
  iconContainer: {
    marginBottom: 4,
    backfaceVisibility: "hidden",
  },
  label: {
    height: 16,
  },
  thumb: {
    position: "absolute",
    height: 4,
    top: 0,
    borderRadius: 2,
    zIndex: 0,
    backgroundColor: theme.colors.text.default,
  },
}))
