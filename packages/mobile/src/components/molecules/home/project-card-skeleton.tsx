import { Box } from "@/components/ui/primitives"
import { Skeleton } from "@/components/ui/primitives/skeleton"

export const ProjectCardSkeleton = () => {
  return (
    <Box
      background="subtle"
      rounded="lg"
      border="subtle"
      p="md"
      gap="sm"
      style={{
        width: 160,
        height: 100,
      }}
    >
      <Box direction="row" justifyContent="space-between" alignItems="center">
        <Skeleton width={16} height={16} rounded="full" />
      </Box>

      <Box flex justifyContent="space-between">
        <Skeleton width={100} height={16} />
        <Box gap="xs">
          <Skeleton width={120} height={12} />
          <Skeleton width={80} height={12} />
        </Box>
      </Box>
    </Box>
  )
}
