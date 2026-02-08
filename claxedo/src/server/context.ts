/**
 * Gateway context type definitions
 */
import type { Identity } from "./types/roles.ts"

export interface GatewayVariables {
  reqId: string
  startTime: number
  identity?: Identity | null
}

export type GatewayContext = { Variables: GatewayVariables }
