import React from "react"
import { Box } from "@/components/ui/primitives"
import { SessionsListOptimized, HomeHeaderOptimized } from "@/components/molecules/home"

const HeaderWrapper = () => <HomeHeaderOptimized />

export const HomePage = () => {
  return (
    <Box flex safeAreaTop background="base">
      <SessionsListOptimized ListHeaderComponent={HeaderWrapper} />
    </Box>
  )
}
