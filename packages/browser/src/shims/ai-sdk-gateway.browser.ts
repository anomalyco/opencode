// Stub for @ai-sdk/gateway - provides exports that ai SDK needs
export function gateway(baseURL?: string) {
  return function (modelId: string) {
    throw new Error(`AI Gateway not available in browser. Model: ${modelId}`)
  }
}

export class GatewayAuthenticationError extends Error {
  constructor(message?: string) {
    super(message || "Gateway authentication error")
    this.name = "GatewayAuthenticationError"
  }
  static isInstance(error: unknown): error is GatewayAuthenticationError {
    return error instanceof GatewayAuthenticationError
  }
}

export class GatewayModelNotFoundError extends Error {
  constructor(message?: string) {
    super(message || "Gateway model not found")
    this.name = "GatewayModelNotFoundError"
  }
  static isInstance(error: unknown): error is GatewayModelNotFoundError {
    return error instanceof GatewayModelNotFoundError
  }
}

export const createGateway = gateway

export default gateway
