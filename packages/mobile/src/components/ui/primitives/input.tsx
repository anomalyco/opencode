import { TextInput, View, Pressable, useColorScheme, Animated } from "react-native"
import type { StyleProp, TextInputProps, TextStyle, ViewStyle, Insets } from "react-native"
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles"
import { createContext, useContext, useMemo, forwardRef } from "react"
import { getIconSize } from "@/config/theme"

type InputContextType = {
  size: "sm" | "md" | "lg"
  variant?: "filled" | "outline"
  mode?: "secondary" | "warning" | "error" | "success" | "disabled"
}

const InputContext = createContext<InputContextType>({
  size: "md",
  variant: undefined,
  mode: undefined,
})

export type InputProps = TextInputProps & {
  style?: StyleProp<TextStyle>
  size?: "sm" | "md" | "lg"
  variant?: "filled" | "outline"
  mode?: "secondary" | "warning" | "error" | "success" | "disabled"
  m?: "sm" | "md" | "lg"
  mt?: "sm" | "md" | "lg"
  mb?: "sm" | "md" | "lg"
  gap?: "sm" | "md" | "lg"
  leftAccessory?: React.ReactNode
  rightAccessory?: React.ReactNode
  hitSlop?: Insets | number
}

type IconRenderProps = {
  color?: string
  size?: number
}

type AccessoryProps = {
  children: React.ReactNode | ((props: IconRenderProps) => React.ReactNode)
  onPress?: () => void
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}

const getIconColor = (mode?: InputContextType["mode"]) => {
  const theme = UnistylesRuntime.getTheme()

  if (mode) return theme.colors[mode][500]
  return theme.colors.primary[500]
}

const Accessory = ({ children, onPress, disabled, style }: AccessoryProps) => {
  const { size, mode } = useContext(InputContext)
  const scale = new Animated.Value(1)

  const onPressIn = () => {
    Animated.spring(scale, {
      toValue: 0.97,
      useNativeDriver: true,
    }).start()
  }

  const onPressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
    }).start()
  }

  const iconProps = useMemo(() => {
    return {
      size: getIconSize(size),
      color: getIconColor(mode),
    }
  }, [size, mode])

  const content = (
    <View style={[accessoryStyles.container, style]}>
      {typeof children === "function" ? children(iconProps) : children}
    </View>
  )

  if (onPress) {
    return (
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          onPress={onPress}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          disabled={disabled || mode === "disabled"}
          style={({ pressed }) => [accessoryStyles.pressable, pressed && accessoryStyles.pressed]}
        >
          {content}
        </Pressable>
      </Animated.View>
    )
  }

  return content
}

const accessoryStyles = StyleSheet.create((theme) => ({
  container: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.md,
    height: "100%",
  },
  pressable: {},
  pressed: {
    opacity: 0.7,
  },
}))

const Input = forwardRef<TextInput, InputProps>(function Input(
  { style, size = "md", variant, mode, m, mt, mb, gap, leftAccessory, rightAccessory, hitSlop, ...props },
  ref,
) {
  const colorScheme = useColorScheme()

  const placeholderTextColor = useMemo(() => {
    const theme = UnistylesRuntime.getTheme()
    return colorScheme === "dark" ? theme.colors.text.subtle : theme.colors.text.subtle
  }, [colorScheme])

  const contextValue = {
    size,
    variant,
    mode,
  }

  styles.useVariants({
    size,
    m,
    mt,
    mb,
    gap,
    variant,
    mode,
    hasLeftAccessory: !!leftAccessory,
    hasRightAccessory: !!rightAccessory,
  })

  const inputContent = (
    <View style={styles.container}>
      {leftAccessory && <View style={styles.accessory}>{leftAccessory}</View>}
      <TextInput
        ref={ref}
        style={[styles.base, style]}
        placeholderTextColor={placeholderTextColor}
        editable={mode !== "disabled"}
        {...props}
      />
      {rightAccessory && <View style={styles.accessory}>{rightAccessory}</View>}
    </View>
  )

  return (
    <InputContext.Provider value={contextValue}>
      {hitSlop ? (
        <Pressable onPress={() => ref && typeof ref !== "function" && ref.current?.focus()} hitSlop={hitSlop}>
          {inputContent}
        </Pressable>
      ) : (
        inputContent
      )}
    </InputContext.Provider>
  )
}) as React.ForwardRefExoticComponent<InputProps & React.RefAttributes<TextInput>> & {
  Accessory: typeof Accessory
}

Input.Accessory = Accessory

export { Input }

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    height: 40,
    variants: {
      size: {
        sm: {
          height: 36,
        },
        md: {
          height: 44,
        },
        lg: {
          height: 50,
        },
      },
      m: {
        sm: { margin: theme.spacing.sm },
        md: { margin: theme.spacing.md },
        lg: { margin: theme.spacing.lg },
      },
      mt: {
        sm: { marginTop: theme.spacing.sm },
        md: { marginTop: theme.spacing.md },
        lg: { marginTop: theme.spacing.lg },
      },
      mb: {
        sm: { marginBottom: theme.spacing.sm },
        md: { marginBottom: theme.spacing.md },
        lg: { marginBottom: theme.spacing.lg },
      },
      gap: {
        sm: { gap: theme.spacing.sm },
        md: { gap: theme.spacing.md },
        lg: { gap: theme.spacing.lg },
      },
      variant: {
        default: {
          backgroundColor: theme.colors.background.subtle,
          borderWidth: 1,
          borderColor: theme.colors.border.default,
        },
        filled: {
          backgroundColor: theme.colors.background.subtle,
        },
        outline: {
          backgroundColor: "transparent",
          borderWidth: 1,
          borderColor: theme.colors.border.default,
        },
      },

      mode: {
        default: {
          // borderColor: theme.colors.border.default,
        },
        secondary: {
          borderColor: theme.colors.primary[500],
        },
        warning: {
          borderColor: theme.colors.warning[500],
        },
        error: {
          borderColor: theme.colors.error[500],
        },
        success: {
          borderColor: theme.colors.success[500],
        },
        disabled: {
          borderColor: theme.colors.border.subtle,
          backgroundColor: theme.colors.background.subtle,
        },
      },
      hasLeftAccessory: {
        true: {},
      },
      hasRightAccessory: {
        true: {},
      },
    },
  },
  accessory: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
  },
  base: {
    flex: 1,
    alignSelf: "stretch",
    fontFamily: theme.typography.family.mono,

    color: theme.colors.text.default,
    variants: {
      size: {
        default: {
          fontSize: theme.typography.size.md,
          paddingHorizontal: theme.spacing.md,
        },
        sm: {
          fontSize: theme.typography.size.sm,
          paddingHorizontal: theme.spacing.sm,
        },
        md: {
          fontSize: theme.typography.size.md,
          paddingHorizontal: theme.spacing.md,
        },
        lg: {
          fontSize: theme.typography.size.lg,
          paddingHorizontal: theme.spacing.lg,
        },
      },
      mode: {
        warning: {
          color: theme.colors.warning[500],
        },
        error: {
          color: theme.colors.error[500],
        },
        success: {
          color: theme.colors.success[500],
        },
        disabled: {
          color: theme.colors.text.subtle,
        },
      },
      variant: {
        filled: {},
        outline: {},
      },
      hasLeftAccessory: {
        true: {
          paddingLeft: 0,
        },
      },
      hasRightAccessory: {
        true: {
          paddingRight: 0,
        },
      },
    },
  },
}))
