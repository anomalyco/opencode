import type { ReactNode } from "react"
import { View, Text, useColorScheme, Platform, type ViewStyle, type TextStyle } from "react-native"
import RNMarkdown, { Renderer } from "react-native-marked"
import { CodeBlock } from "./CodeBlock"

class CustomRenderer extends Renderer {
  code(text: string, language?: string, containerStyle?: ViewStyle, _textStyle?: TextStyle) {
    return (
      <View key={this.getKey()} style={containerStyle}>
        <CodeBlock code={text} language={language} />
      </View>
    )
  }

  codespan(text: string, styles?: TextStyle): ReactNode {
    return (
      <Text selectable key={this.getKey()} style={[styles, { fontStyle: "normal", fontWeight: "normal" }]}>
        {text}
      </Text>
    )
  }
}

const renderer = new CustomRenderer()

const mono = Platform.OS === "ios" ? "Menlo" : "monospace"

const lightTheme = {
  text: { color: "#0a0a0a", fontSize: 15, lineHeight: 22 },
  paragraph: { marginTop: 0, marginBottom: 8 },
  heading1: { fontSize: 22, fontWeight: "700" as const, color: "#0a0a0a", marginBottom: 8, marginTop: 12 },
  heading2: { fontSize: 19, fontWeight: "600" as const, color: "#0a0a0a", marginBottom: 6, marginTop: 10 },
  heading3: { fontSize: 16, fontWeight: "600" as const, color: "#0a0a0a", marginBottom: 4, marginTop: 8 },
  link: { color: "#8b5cf6" },
  blockquote: {
    backgroundColor: "transparent",
    borderLeftWidth: 3,
    borderLeftColor: "#d1d5db",
    paddingLeft: 12,
    paddingVertical: 2,
    marginVertical: 4,
  },
  code: {
    backgroundColor: "#e8e5f0",
    color: "#6d28d9",
    fontFamily: mono,
    fontSize: 13,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  codespan: {
    backgroundColor: "#e8e5f0",
    color: "#6d28d9",
    fontFamily: mono,
    fontSize: 13,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  list: { marginBottom: 4 },
  listItem: { marginBottom: 2 },
  hr: { backgroundColor: "#e5e5e5", height: 1, marginVertical: 12 },
  strong: { fontWeight: "700" as const },
  em: { fontStyle: "italic" as const },
  strikethrough: { textDecorationLine: "line-through" as const },
  image: { borderRadius: 8 },
}

const darkTheme = {
  ...lightTheme,
  text: { ...lightTheme.text, color: "#e5e5e5" },
  heading1: { ...lightTheme.heading1, color: "#ffffff" },
  heading2: { ...lightTheme.heading2, color: "#ffffff" },
  heading3: { ...lightTheme.heading3, color: "#ffffff" },
  link: { color: "#a78bfa" },
  blockquote: {
    ...lightTheme.blockquote,
    borderLeftColor: "#4a4a5a",
  },
  code: {
    ...lightTheme.code,
    backgroundColor: "#2a2040",
    color: "#c4b5fd",
  },
  codespan: {
    ...lightTheme.codespan,
    backgroundColor: "#2a2040",
    color: "#c4b5fd",
  },
  hr: { ...lightTheme.hr, backgroundColor: "#2a2a2a" },
}

interface Props {
  children: string
}

export function Markdown({ children }: Props) {
  const isDark = useColorScheme() === "dark"
  const theme = isDark ? darkTheme : lightTheme

  if (!children?.trim()) return null

  return (
    <RNMarkdown
      value={children}
      renderer={renderer}
      styles={theme}
      flatListProps={{
        scrollEnabled: false,
        initialNumToRender: 50,
        style: { backgroundColor: "transparent" },
        contentContainerStyle: { backgroundColor: "transparent" },
      }}
    />
  )
}
