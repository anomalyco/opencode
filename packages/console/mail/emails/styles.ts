// @ts-nocheck
export const unit = 12
export const PRIMARY_COLOR = "#211E1E"
export const TEXT_COLOR = "#656363"
export const LINK_COLOR = "#007AFF"
export const LINK_BACKGROUND_COLOR = "#F9F8F8"
export const BACKGROUND_COLOR = "#F0F0F1"
export const SURFACE_DIVIDER_COLOR = "#D5D5D9"

export const body = {
  background: BACKGROUND_COLOR,
}

export const container = {
  minWidth: "600px",
  padding: "64px 0px",
}

export const frame = {
  padding: `${unit * 2}px`,
  border: `1px solid ${SURFACE_DIVIDER_COLOR}`,
  background: "#FFF",
  borderRadius: "6px",
  boxShadow: `0 1px 2px rgba(0,0,0,0.03),
              0 2px 4px rgba(0,0,0,0.03),
              0 2px 6px rgba(0,0,0,0.03)`,
}

export const baseText = {
  fontFamily: "JetBrains Mono, monospace",
}

export const headingText = {
  color: PRIMARY_COLOR,
  fontSize: "16px",
  fontStyle: "normal",
  fontWeight: 500,
  lineHeight: "normal",
}

export const contentText = {
  color: TEXT_COLOR,
  fontSize: "14px",
  fontStyle: "normal",
  fontWeight: 400,
  lineHeight: "180%",
}

export const buttonText = {
  color: "#FDFCFC",
  fontSize: "16px",
  fontWeight: 500,
  margin: 0,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  gap: "12px",
}

export const linkText = {
  color: LINK_COLOR,
  fontSize: "14px",
  fontStyle: "normal",
  fontWeight: 400,
  lineHeight: "150%",
  textDecorationLine: "underline",
  textDecorationStyle: "solid" as const,
  textDecorationSkipInk: "auto" as const,
  textDecorationThickness: "auto",
  textUnderlineOffset: "auto",
  textUnderlinePosition: "from-font",
  borderRadius: "4px",
  background: LINK_BACKGROUND_COLOR,
  padding: "8px 12px",
  textAlign: "center" as const,
}

export const contentHighlightText = {
  color: PRIMARY_COLOR,
}

export const button = {
  display: "inline-grid",
  padding: "8px 12px 8px 20px",
  justifyContent: "center",
  alignItems: "center",
  gap: "8px",
  flexShrink: "0",
  borderRadius: "4px",
  backgroundColor: PRIMARY_COLOR,
}
