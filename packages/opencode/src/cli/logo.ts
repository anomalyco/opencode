export type LogoTone = "brand" | "brandShadow" | "company" | "wordmark"

export interface LogoSegment {
  text: string
  tone: LogoTone
  bold?: boolean
}

export type LogoRow = LogoSegment[]

export const logoRows: LogoRow[] = [
  [
    { text: " ███████╗ ███████╗  ██████╗ ██╗   ██╗ ██████╗  ███████╗      ██████╗  ██████╗   ██████╗  ███████╗", tone: "wordmark", bold: true },
  ],
  [
    { text: " ██╔════╝ ██╔════╝ ██╔════╝ ██║   ██║ ██╔══██╗ ██╔════╝     ██╔════╝ ██╔═══██╗  ██╔══██╗ ██╔════╝", tone: "wordmark", bold: true },
  ],
  [
    { text: " ███████╗ █████╗   ██║      ██║   ██║ ██████╔╝ █████╗       ██║      ██║   ██║  ██║  ██║ █████╗  ", tone: "wordmark", bold: true },
  ],
  [
    { text: " ╚════██║ ██╔══╝   ██║      ██║   ██║ ██╔══██╗ ██╔══╝       ██║      ██║   ██║  ██║  ██║ ██╔══╝  ", tone: "wordmark", bold: true },
  ],
  [
    { text: " ███████║ ███████╗ ╚██████╗ ╚██████╔╝ ██║  ██║ ███████╗     ╚██████╗ ╚██████╔╝  ██████╔╝ ███████╗", tone: "wordmark", bold: true },
  ],
  [
    { text: " ╚══════╝ ╚══════╝  ╚═════╝  ╚═════╝  ╚═╝  ╚═╝ ╚══════╝      ╚═════╝  ╚═════╝   ╚═════╝  ╚══════╝", tone: "wordmark", bold: true },
  ],
]
