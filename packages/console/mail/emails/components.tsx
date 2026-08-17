// @ts-nocheck
import React from "react"
import { Font, Text as JEText, type TextProps } from "@jsx-email/all"
import { baseText } from "./styles"

export function Text(props: TextProps) {
  return <JEText {...props} style={{ ...baseText, ...props.style }} />
}

export function Title({ children }: TitleProps) {
  return React.createElement("title", null, children)
}

export function A({ children, ...props }: AProps) {
  return React.createElement("a", props, children)
}

export function Span({ children, ...props }: SpanProps) {
  return React.createElement("span", props, children)
}

export function Fonts({ assetsUrl }: { assetsUrl: string }) {
  return (
    <>
      <Font
        fontFamily="JetBrains Mono"
        fallbackFontFamily="monospace"
        webFont={{
          url: `${assetsUrl}/JetBrainsMono-Regular.woff2`,
          format: "woff2",
        }}
        fontWeight="400"
        fontStyle="normal"
      />
      <Font
        fontFamily="JetBrains Mono"
        fallbackFontFamily="monospace"
        webFont={{
          url: `${assetsUrl}/JetBrainsMono-Medium.woff2`,
          format: "woff2",
        }}
        fontWeight="500"
        fontStyle="normal"
      />
      <Font
        fontFamily="Rubik"
        fallbackFontFamily={["Helvetica", "Arial", "sans-serif"]}
        webFont={{
          url: `${assetsUrl}/rubik-latin.woff2`,
          format: "woff2",
        }}
        fontWeight="400 500 600 700"
        fontStyle="normal"
      />
    </>
  )
}
