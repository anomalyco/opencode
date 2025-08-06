import type { StyleProp, ViewStyle } from "react-native"
import { View } from "react-native"
import { StyleSheet, useUnistyles } from "react-native-unistyles"
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  runOnJS,
} from "react-native-reanimated"
import { useEffect } from "react"

type AnimationType =
  | "fade-in"
  | "fade-out"
  | "slide-up"
  | "slide-down"
  | "slide-left"
  | "slide-right"
  | "scale-in"
  | "scale-out"
  | "bounce-in"
  | "shake"
  | "pulse"

type AnimationConfig = {
  duration?: number
  delay?: number
  repeat?: number
  onComplete?: () => void
}

const getAnimationValues = (animationType: AnimationType) => {
  switch (animationType) {
    case "fade-in":
      return { opacity: { from: 0, to: 1 } }
    case "fade-out":
      return { opacity: { from: 1, to: 0 } }
    case "slide-up":
      return { translateY: { from: 50, to: 0 }, opacity: { from: 0, to: 1 } }
    case "slide-down":
      return { translateY: { from: -50, to: 0 }, opacity: { from: 0, to: 1 } }
    case "slide-left":
      return { translateX: { from: 50, to: 0 }, opacity: { from: 0, to: 1 } }
    case "slide-right":
      return { translateX: { from: -50, to: 0 }, opacity: { from: 0, to: 1 } }
    case "scale-in":
      return { scale: { from: 0, to: 1 }, opacity: { from: 0, to: 1 } }
    case "scale-out":
      return { scale: { from: 1, to: 0 }, opacity: { from: 1, to: 0 } }
    case "bounce-in":
      return { scale: { from: 0, to: 1 }, opacity: { from: 0, to: 1 } }
    case "shake":
      return { translateX: { from: 0, to: 10 } }
    case "pulse":
      return { scale: { from: 1, to: 1.05 } }
    default:
      return {}
  }
}

const useAnimations = (animations: AnimationType | AnimationType[] | undefined, config: AnimationConfig = {}) => {
  const opacity = useSharedValue(1)
  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)
  const scale = useSharedValue(1)

  const { duration = 300, delay = 0, repeat = 0, onComplete } = config

  useEffect(() => {
    if (!animations) return

    const animationList = Array.isArray(animations) ? animations : [animations]

    const initializeValues = () => {
      animationList.forEach((animation) => {
        const values = getAnimationValues(animation)
        if (values.opacity) opacity.value = values.opacity.from
        if (values.translateX) translateX.value = values.translateX.from
        if (values.translateY) translateY.value = values.translateY.from
        if (values.scale) scale.value = values.scale.from
      })
    }

    const runAnimations = () => {
      animationList.forEach((animation, index) => {
        const values = getAnimationValues(animation)
        const animationDelay = delay + index * 100

        const runAnimation = () => {
          if (values.opacity) {
            opacity.value = withTiming(values.opacity.to, { duration })
          }

          if (values.translateX) {
            if (animation === "shake") {
              translateX.value = withSequence(
                withTiming(10, { duration: 50 }),
                withTiming(-10, { duration: 50 }),
                withTiming(10, { duration: 50 }),
                withTiming(-10, { duration: 50 }),
                withTiming(0, { duration: 50 }),
              )
            } else {
              translateX.value = withTiming(values.translateX.to, { duration })
            }
          }

          if (values.translateY) {
            translateY.value = withTiming(values.translateY.to, { duration })
          }

          if (values.scale) {
            if (animation === "bounce-in") {
              scale.value = withSpring(values.scale.to, {
                damping: 8,
                stiffness: 100,
              })
            } else if (animation === "pulse") {
              scale.value = withSequence(
                withTiming(1.05, { duration: duration / 2 }),
                withTiming(1, { duration: duration / 2 }),
              )
            } else {
              scale.value = withTiming(values.scale.to, { duration }, (finished) => {
                if (finished && onComplete && index === animationList.length - 1) {
                  runOnJS(onComplete)()
                }
              })
            }
          }
        }

        if (animationDelay > 0) {
          setTimeout(runAnimation, animationDelay)
        } else {
          runAnimation()
        }
      })
    }

    initializeValues()

    const timer = setTimeout(() => {
      runAnimations()

      if (repeat > 0) {
        const repeatInterval = setInterval(
          () => {
            initializeValues()
            runAnimations()
          },
          duration + delay + 100,
        )

        setTimeout(
          () => {
            clearInterval(repeatInterval)
          },
          (duration + delay + 100) * repeat,
        )
      }
    }, 16)

    return () => clearTimeout(timer)
  }, [animations, duration, delay, repeat, onComplete])

  const animatedStyle = useAnimatedStyle(() => {
    const transforms = []
    if (translateX.value !== 0) {
      transforms.push({ translateX: translateX.value })
    }
    if (translateY.value !== 0) {
      transforms.push({ translateY: translateY.value })
    }
    if (scale.value !== 1) {
      transforms.push({ scale: scale.value })
    }

    return {
      opacity: opacity.value,
      transform: transforms.length > 0 ? transforms : undefined,
    }
  })

  return animatedStyle
}

export type BoxProps = {
  style?: StyleProp<ViewStyle>
  children?: React.ReactNode
  background?:
    | "plain"
    | "dim"
    | "subtle"
    | "emphasis"
    | "base"
    | "inverse"
    | "light"
    | "lighter"
    | "lightest"
    | "dark"
    | "darker"
    | "darkest"
  p?: "xs" | "sm" | "md" | "lg"
  pt?: "xs" | "sm" | "md" | "lg"
  pb?: "xs" | "sm" | "md" | "lg"
  pl?: "xs" | "sm" | "md" | "lg"
  pr?: "xs" | "sm" | "md" | "lg"
  border?: "none" | "subtle" | "thin" | "thick"
  shadow?: "none" | "sm" | "md" | "lg"
  mode?: "primary" | "brand" | "secondary" | "warning" | "error" | "success" | "disabled"
  rounded?: "none" | "sm" | "md" | "lg" | "xl" | "full"
  direction?: "row" | "column"
  m?: "xs" | "sm" | "md" | "lg"
  mt?: "xs" | "sm" | "md" | "lg"
  mb?: "xs" | "sm" | "md" | "lg"
  ml?: "xs" | "sm" | "md" | "lg"
  mr?: "xs" | "sm" | "md" | "lg"
  gap?: "xs" | "sm" | "md" | "lg"
  flex?: boolean
  center?: boolean
  safeArea?: boolean
  safeAreaTop?: boolean
  safeAreaBottom?: boolean
  justifyContent?: "flex-start" | "center" | "flex-end" | "space-between" | "space-around" | "space-evenly"
  alignItems?: "flex-start" | "center" | "flex-end" | "stretch"
  animation?: AnimationType | AnimationType[]
  animationConfig?: AnimationConfig
}

const Box = ({
  children,
  style,
  background,
  p,
  pt,
  pb,
  pl,
  pr,
  border,
  shadow,
  mode,
  rounded,
  direction,
  m,
  mt,
  mb,
  ml,
  mr,
  gap,
  flex,
  center,
  safeArea,
  safeAreaTop,
  safeAreaBottom,
  justifyContent,
  alignItems,
  animation,
  animationConfig,
}: BoxProps) => {
  const { rt } = useUnistyles()
  const isDark = rt.themeName === "dark"
  let shadowNow = shadow
  let borderNow = border
  if (isDark && shadow) {
    shadowNow = "none"
  }

  const animatedStyle = useAnimations(animation, animationConfig)

  styles.useVariants({
    background,
    p,
    pt,
    pb,
    pl,
    pr,
    border: borderNow,
    shadow: shadowNow,
    mode,
    rounded,
    direction,
    m,
    mt,
    mb,
    ml,
    mr,
    gap,
    flex,
    center,
    safeArea,
    safeAreaTop,
    safeAreaBottom,
    justifyContent,
    alignItems,
  })

  const Component = animation ? Animated.View : View
  const componentStyle = animation ? [styles.base, style, animatedStyle] : [styles.base, style]

  return <Component style={componentStyle}>{children}</Component>
}

export { Box }

const styles = StyleSheet.create((theme, rt) => ({
  base: {
    borderCurve: "continuous",
    shadowColor: theme.colors.contrast.base,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
    variants: {
      flex: {
        true: {
          flex: 1,
        },
      },
      justifyContent: {
        "flex-start": {
          justifyContent: "flex-start",
        },
        center: {
          justifyContent: "center",
        },
        "flex-end": {
          justifyContent: "flex-end",
        },
        "space-between": {
          justifyContent: "space-between",
        },
        "space-around": {
          justifyContent: "space-around",
        },
        "space-evenly": {
          justifyContent: "space-evenly",
        },
      },
      alignItems: {
        "flex-start": {
          alignItems: "flex-start",
        },
        center: {
          alignItems: "center",
        },
        "flex-end": {
          alignItems: "flex-end",
        },
        stretch: {
          alignItems: "stretch",
        },
      },
      center: {
        true: {
          justifyContent: "center",
          alignItems: "center",
        },
      },
      background: {
        default: {
          backgroundColor: "transparent",
        },
        plain: {
          backgroundColor: theme.colors.background.plain,
        },
        dim: {
          backgroundColor: theme.colors.background.dim,
        },
        base: {
          backgroundColor: theme.colors.background.default,
        },
        inverse: {
          backgroundColor: theme.colors.background.inverse,
        },
        subtle: {
          backgroundColor: theme.colors.background.subtle,
        },
        emphasis: {
          backgroundColor: theme.colors.background.emphasis,
        },
        light: {
          backgroundColor: theme.colors.background.light,
        },
        lighter: {
          backgroundColor: theme.colors.background.lighter,
        },
        lightest: {
          backgroundColor: theme.colors.background.lightest,
        },
        dark: {
          backgroundColor: theme.colors.background.dark,
        },
        darker: {
          backgroundColor: theme.colors.background.darker,
        },
        darkest: {
          backgroundColor: theme.colors.background.darkest,
        },
      },
      p: {
        xs: {
          padding: theme.spacing.xs,
        },
        sm: {
          padding: theme.spacing.sm,
        },
        md: {
          padding: theme.spacing.md,
        },
        lg: {
          padding: theme.spacing.lg,
        },
      },
      pt: {
        xs: {
          paddingTop: theme.spacing.xs,
        },
        sm: {
          paddingTop: theme.spacing.sm,
        },
        md: {
          paddingTop: theme.spacing.md,
        },
        lg: {
          paddingTop: theme.spacing.lg,
        },
      },
      pb: {
        xs: {
          paddingBottom: theme.spacing.xs,
        },
        sm: {
          paddingBottom: theme.spacing.sm,
        },
        md: {
          paddingBottom: theme.spacing.md,
        },
        lg: {
          paddingBottom: theme.spacing.lg,
        },
      },
      pl: {
        xs: {
          paddingLeft: theme.spacing.xs,
        },
        sm: {
          paddingLeft: theme.spacing.sm,
        },
        md: {
          paddingLeft: theme.spacing.md,
        },
        lg: {
          paddingLeft: theme.spacing.lg,
        },
      },
      pr: {
        xs: {
          paddingRight: theme.spacing.xs,
        },
        sm: {
          paddingRight: theme.spacing.sm,
        },
        md: {
          paddingRight: theme.spacing.md,
        },
        lg: {
          paddingRight: theme.spacing.lg,
        },
      },

      border: {
        default: {
          borderWidth: 0,
        },
        none: {
          borderWidth: 0,
        },
        subtle: {
          borderWidth: 0.5,
          borderColor: theme.colors.border.subtle,
        },
        thin: {
          borderWidth: 1,
          borderColor: theme.colors.border.default,
        },
        thick: {
          borderWidth: 2,
          borderColor: theme.colors.border.default,
        },
      },
      shadow: {
        none: {
          shadowOpacity: 0,
          shadowRadius: 0,
          elevation: 0,
        },
        sm: {
          shadowOpacity: 0.2,
          shadowRadius: 3,
          elevation: 2,
        },
        md: {
          shadowOpacity: 0.4,
          shadowRadius: 8,
          elevation: 4,
        },
        lg: {
          shadowOpacity: 0.5,
          shadowRadius: 16,
          elevation: 8,
        },
      },
      mode: {
        primary: {
          borderColor: theme.colors.primary[500],
          backgroundColor: `${theme.colors.primary[500]}30`,
        },
        brand: {
          borderColor: theme.colors.brand[500],
          backgroundColor: `${theme.colors.brand[500]}30`,
        },
        secondary: {
          borderColor: theme.colors.secondary[500],
          backgroundColor: `${theme.colors.secondary[500]}30`,
        },
        warning: {
          borderColor: theme.colors.warning[500],
          backgroundColor: `${theme.colors.warning[500]}30`,
        },
        error: {
          borderColor: theme.colors.error[500],
          backgroundColor: `${theme.colors.error[500]}30`,
        },
        success: {
          borderColor: theme.colors.success[500],
          backgroundColor: `${theme.colors.success[500]}30`,
        },
        disabled: {
          opacity: 0.5,
          backgroundColor: theme.colors.background.subtle,
          borderColor: theme.colors.border.subtle,
        },
      },
      rounded: {
        none: {
          borderRadius: theme.radius.none,
        },
        sm: {
          borderRadius: theme.radius.sm,
        },
        md: {
          borderRadius: theme.radius.md,
        },
        lg: {
          borderRadius: theme.radius.lg,
        },
        xl: {
          borderRadius: theme.radius.xl,
        },
        full: {
          borderRadius: theme.radius.full,
        },
      },
      direction: {
        row: {
          flexDirection: "row",
        },
        column: {
          flexDirection: "column",
        },
      },
      m: {
        xs: {
          margin: theme.spacing.xs,
        },
        sm: {
          margin: theme.spacing.sm,
        },
        md: {
          margin: theme.spacing.md,
        },
        lg: {
          margin: theme.spacing.lg,
        },
      },
      mt: {
        xs: {
          marginTop: theme.spacing.xs,
        },
        sm: {
          marginTop: theme.spacing.sm,
        },
        md: {
          marginTop: theme.spacing.md,
        },
        lg: {
          marginTop: theme.spacing.lg,
        },
      },
      mb: {
        xs: {
          marginBottom: theme.spacing.xs,
        },
        sm: {
          marginBottom: theme.spacing.sm,
        },
        md: {
          marginBottom: theme.spacing.md,
        },
        lg: {
          marginBottom: theme.spacing.lg,
        },
      },
      ml: {
        xs: {
          marginLeft: theme.spacing.xs,
        },
        sm: {
          marginLeft: theme.spacing.sm,
        },
        md: {
          marginLeft: theme.spacing.md,
        },
        lg: {
          marginLeft: theme.spacing.lg,
        },
      },
      mr: {
        xs: {
          marginRight: theme.spacing.xs,
        },
        sm: {
          marginRight: theme.spacing.sm,
        },
        md: {
          marginRight: theme.spacing.md,
        },
        lg: {
          marginRight: theme.spacing.lg,
        },
      },
      gap: {
        xs: {
          gap: theme.spacing.xs,
        },
        sm: {
          gap: theme.spacing.sm,
        },
        md: {
          gap: theme.spacing.md,
        },
        lg: {
          gap: theme.spacing.lg,
        },
      },
      safeArea: {
        true: {
          paddingTop: rt.insets.top,
          paddingBottom: rt.insets.bottom,
        },
      },
      safeAreaTop: {
        true: {
          paddingTop: rt.insets.top,
        },
      },
      safeAreaBottom: {
        true: {
          paddingBottom: rt.insets.bottom,
        },
      },
    },
  },
}))
