import { Box } from "@/components/ui/primitives"
import { Skeleton } from "@/components/ui/primitives/skeleton"

export const SessionItemSkeleton = () => {
  return (
    <Box background="subtle" rounded="lg" border="subtle" p="md" direction="row" alignItems="center" gap="md">
      <Skeleton width={40} height={40} rounded="lg" />

      <Box flex gap="xs">
        <Skeleton width={200} height={16} />
        <Skeleton width={120} height={12} />
      </Box>
    </Box>
  )
}
