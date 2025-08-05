import type { ViewStyle } from "react-native"
import { Box } from "./box"

interface SkeletonProps {
  width?: number
  height?: number
  rounded?: "sm" | "md" | "lg" | "none" | "xl" | "full"
  style?: ViewStyle
}

export const Skeleton = ({ width, height, rounded = "md", style }: SkeletonProps) => {
  return (
    <Box
      background="subtle"
      rounded={rounded}
      style={{ width, height, ...style }}
      animation="pulse"
      animationConfig={{ repeat: -1 }}
    />
  )
}
