import type { ColorValue } from "react-native"
import Marked, { type MarkedStyles } from "react-native-marked"
import { useUnistyles } from "react-native-unistyles"
interface ThemedMarkedProps {
  value: string
}
interface ColorsPropType {
  code: ColorValue
  link: ColorValue
  text: ColorValue
  border: ColorValue
  /**
   * @deprecated Use flatlist containerStyle or style prop for setting background color
   */
  background?: ColorValue
}

type SpacingKeysType = "xs" | "s" | "m" | "l"

type UserTheme = {
  colors?: ColorsPropType
  spacing?: Record<SpacingKeysType, number>
}

export const ThemedMarked = ({ value }: ThemedMarkedProps) => {
  const { theme } = useUnistyles()

  const userTheme: UserTheme = {
    colors: {
      background: "transparent",
      text: theme.colors.text.default,
      border: theme.colors.border.default,
      link: theme.colors.brand.base,
      code: "transparent",
    },
    spacing: {
      xs: 2,
      s: 4,
      m: 8,
      l: 16,
    },
  }

  const customStyles: MarkedStyles = {
    paragraph: {
      backgroundColor: "transparent",
      paddingVertical: 4,
    },
    code: {
      backgroundColor: "transparent",
      padding: 8,
    },
    codespan: {
      backgroundColor: "rgba(0,0,0,0.1)",
      fontFamily: "monospace",
    },
  }

  return (
    <Marked
      value={value}
      styles={customStyles}
      theme={userTheme}
      flatListProps={{
        style: { backgroundColor: "transparent" },
        contentContainerStyle: { backgroundColor: "transparent" },
      }}
    />
  )
}
