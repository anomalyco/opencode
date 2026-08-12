import { RpcClientError as RpcClientErrors } from "effect/unstable/rpc"

export const RpcClientError = RpcClientErrors.RpcClientError
export type RpcClientError = RpcClientErrors.RpcClientError

export { FileSystemError } from "../project.js"

export { OpenCodeDriverError } from "../driver/error.js"
export { LlmControllerError, LlmModeError } from "../driver/llm-controller.js"
export {
  UiCapabilityError,
  UiElementAmbiguousError,
  UiNodeAmbiguousError,
  UiPredicateError,
  UiTimeoutError,
  UiWaitOptionsError,
} from "../driver/ui.js"
export { SimulationCompatibilityError } from "../simulation/connector.js"
export { SimulationRequestError } from "../simulation/rpc.js"
