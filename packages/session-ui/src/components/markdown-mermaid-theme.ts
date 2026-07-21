import type { MermaidColorScheme } from "./markdown-mermaid"

// Slate theme for mermaid's "base" theme engine, tuned for parsing large charts:
// neutral node surfaces, higher-contrast edges and borders, and desaturated categorical
// hues (state/timeline/git scales) that stay distinguishable without overpowering labels.
// Values must be concrete colors because mermaid derives unset tokens with color math.

type MermaidThemeVariables = Record<string, string | boolean>

function withScales(theme: MermaidThemeVariables, scale: string[], label: string) {
  scale.forEach((color, index) => {
    theme[`cScale${index}`] = color
    theme[`cScaleLabel${index}`] = label
    theme[`git${index}`] = color
    theme[`gitBranchLabel${index}`] = label
  })
  return theme
}

const dark = withScales(
  {
    darkMode: true,
    background: "#101014",
    textColor: "#e2e8f0",
    titleColor: "#f1f5f9",
    lineColor: "#94a3b8",
    defaultLinkColor: "#94a3b8",

    mainBkg: "#1e293b",
    nodeBorder: "#64748b",
    nodeTextColor: "#e2e8f0",
    primaryColor: "#1e293b",
    primaryTextColor: "#e2e8f0",
    primaryBorderColor: "#64748b",
    secondaryColor: "#26324b",
    secondaryBorderColor: "#5b6f96",
    secondaryTextColor: "#dbe4f0",
    tertiaryColor: "#1f3a37",
    tertiaryBorderColor: "#4f7d76",
    tertiaryTextColor: "#d7e8e5",

    clusterBkg: "#161c28",
    clusterBorder: "#475569",
    edgeLabelBackground: "#101014",

    noteBkgColor: "#382e1b",
    noteTextColor: "#ecd9a8",
    noteBorderColor: "#8a7440",

    actorBkg: "#1e293b",
    actorBorder: "#64748b",
    actorTextColor: "#e2e8f0",
    actorLineColor: "#64748b",
    signalColor: "#94a3b8",
    signalTextColor: "#cbd5e1",
    labelBoxBkgColor: "#161c28",
    labelBoxBorderColor: "#475569",
    labelTextColor: "#cbd5e1",
    loopTextColor: "#cbd5e1",
    activationBkgColor: "#334155",
    activationBorderColor: "#94a3b8",
    sequenceNumberColor: "#0f172a",

    errorBkgColor: "#3f1d1d",
    errorTextColor: "#fca5a5",
  },
  ["#334155", "#243d5c", "#1c443c", "#413620", "#3a2b4e", "#46252e", "#2a3f22", "#1b4450"],
  "#e2e8f0",
)

const light = withScales(
  {
    darkMode: false,
    background: "#fafafa",
    textColor: "#1e293b",
    titleColor: "#0f172a",
    lineColor: "#64748b",
    defaultLinkColor: "#64748b",

    mainBkg: "#f1f5f9",
    nodeBorder: "#94a3b8",
    nodeTextColor: "#1e293b",
    primaryColor: "#f1f5f9",
    primaryTextColor: "#1e293b",
    primaryBorderColor: "#94a3b8",
    secondaryColor: "#e5edf8",
    secondaryBorderColor: "#8fa8c9",
    secondaryTextColor: "#243b56",
    tertiaryColor: "#e2f1ee",
    tertiaryBorderColor: "#6fa298",
    tertiaryTextColor: "#1f4d44",

    clusterBkg: "#f8fafc",
    clusterBorder: "#cbd5e1",
    edgeLabelBackground: "#fafafa",

    noteBkgColor: "#faf3dc",
    noteTextColor: "#6a5518",
    noteBorderColor: "#d3bc72",

    actorBkg: "#f1f5f9",
    actorBorder: "#94a3b8",
    actorTextColor: "#1e293b",
    actorLineColor: "#94a3b8",
    signalColor: "#475569",
    signalTextColor: "#334155",
    labelBoxBkgColor: "#f8fafc",
    labelBoxBorderColor: "#cbd5e1",
    labelTextColor: "#334155",
    loopTextColor: "#334155",
    activationBkgColor: "#e2e8f0",
    activationBorderColor: "#64748b",
    sequenceNumberColor: "#f8fafc",

    errorBkgColor: "#fee2e2",
    errorTextColor: "#b91c1c",
  },
  ["#e2e8f0", "#d8e4f3", "#d5ebe4", "#f1e7c6", "#e7def2", "#f4dbe0", "#ddecd3", "#d3e7ee"],
  "#1e293b",
)

export function mermaidThemeVariables(scheme: MermaidColorScheme) {
  return scheme === "dark" ? dark : light
}
