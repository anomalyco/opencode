// @ts-nocheck
import React from "react"
import { Font, Hr as JEHr, Text as JEText, type HrProps, type TextProps } from "@jsx-email/all"
import { DIVIDER_COLOR, SURFACE_DIVIDER_COLOR, textColor } from "./styles"

export function Text(props: TextProps) {
  return <JEText {...props} style={{ ...textColor, ...props.style }} />
}

export function Hr(props: HrProps) {
  return <JEHr {...props} style={{ borderTop: `1px solid ${DIVIDER_COLOR}`, ...props.style }} />
}

export function SurfaceHr(props: HrProps) {
  return (
    <JEHr
      {...props}
      style={{
        borderTop: `1px solid ${SURFACE_DIVIDER_COLOR}`,
        ...props.style,
      }}
    />
  )
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

export function Wbr({ children, ...props }: WbrProps) {
  return React.createElement("wbr", props, children)
}

export function Fonts({ assetsUrl }: { assetsUrl: string }) {
  return (
    <>
      <Font
        fontFamily="IBM Plex Mono"
        fallbackFontFamily="monospace"
        webFont={{
          url: `${assetsUrl}/ibm-plex-mono-latin-400.woff2`,
          format: "woff2",
        }}
        fontWeight="400"
        fontStyle="normal"
      />
      <Font
        fontFamily="IBM Plex Mono"
        fallbackFontFamily="monospace"
        webFont={{
          url: `${assetsUrl}/ibm-plex-mono-latin-500.woff2`,
          format: "woff2",
        }}
        fontWeight="500"
        fontStyle="normal"
      />
      <Font
        fontFamily="IBM Plex Mono"
        fallbackFontFamily="monospace"
        webFont={{
          url: `${assetsUrl}/ibm-plex-mono-latin-600.woff2`,
          format: "woff2",
        }}
        fontWeight="600"
        fontStyle="normal"
      />
      <Font
        fontFamily="IBM Plex Mono"
        fallbackFontFamily="monospace"
        webFont={{
          url: `${assetsUrl}/ibm-plex-mono-latin-700.woff2`,
          format: "woff2",
        }}
        fontWeight="700"
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

export function SplitString({ text, split }: { text: string; split: number }) {
  const segments: JSX.Element[] = []
  for (let i = 0; i < text.length; i += split) {
    segments.push(<>{text.slice(i, i + split)}</>)
    if (i + split < text.length) {
      segments.push(<Wbr key={`${i}wbr`} />)
    }
  }
  return <>{segments}</>
}
