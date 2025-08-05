import { Box } from "@/components/ui/primitives"
import { SessionsList, HomeHeader } from "@/components/molecules/home"

export const HomePage = () => {
  return (
    <Box flex safeAreaTop background="base">
      <SessionsList ListHeaderComponent={HomeHeader} />
    </Box>
  )
}
