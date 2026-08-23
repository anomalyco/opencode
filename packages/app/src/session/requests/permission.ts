import { useServer } from "@/runtime/server/current"

export const usePermission = () => useServer().ctx.permission
