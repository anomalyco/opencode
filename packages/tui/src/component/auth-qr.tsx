import { RGBA } from "@opentui/core"

const qrLight = RGBA.fromInts(255, 255, 255)
const qrDark = RGBA.fromInts(0, 0, 0)

export function AuthQr(props: { blocks: string }) {
  return (
    <text fg={qrLight} bg={qrDark} wrapMode="none" selectable={false}>
      {props.blocks}
    </text>
  )
}
