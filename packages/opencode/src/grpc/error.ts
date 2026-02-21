import { ConnectError, Code } from "@connectrpc/connect"
import { NamedError } from "@opencode-ai/util/error"
import { NotFoundError } from "../storage/db"
import { Provider } from "../provider/provider"

export function toConnectError(err: unknown): ConnectError {
  if (err instanceof ConnectError) return err

  if (NamedError.Unknown.isInstance(err)) {
    return new ConnectError(err.data.message, Code.Internal)
  }

  if (NotFoundError.isInstance(err)) {
    return new ConnectError(err.data.message, Code.NotFound)
  }

  if (Provider.ModelNotFoundError.isInstance(err)) {
    return new ConnectError(`Model not found: ${err.data.providerID}/${err.data.modelID}`, Code.NotFound)
  }

  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.message?.toLowerCase().includes("timeout")) {
      return new ConnectError(err.message, Code.DeadlineExceeded)
    }

    if (err.name === "ValidationError" || err.message?.toLowerCase().includes("validation")) {
      return new ConnectError(err.message, Code.InvalidArgument)
    }

    if (err.message?.toLowerCase().includes("permission") || err.message?.toLowerCase().includes("access denied")) {
      return new ConnectError(err.message, Code.PermissionDenied)
    }

    if (err.message?.toLowerCase().includes("already exists") || err.message?.toLowerCase().includes("duplicate")) {
      return new ConnectError(err.message, Code.AlreadyExists)
    }

    if (
      err.message?.toLowerCase().includes("unavailable") ||
      err.message?.toLowerCase().includes("service unavailable")
    ) {
      return new ConnectError(err.message, Code.Unavailable)
    }

    return new ConnectError(err.message, Code.Internal)
  }

  return new ConnectError(String(err), Code.Internal)
}

export function wrapHandler<T extends (...args: any[]) => any>(handler: T): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    try {
      return await handler(...args)
    } catch (err) {
      throw toConnectError(err)
    }
  }) as T
}

export function wrapStreamHandler<T extends (...args: any[]) => AsyncGenerator<any>>(handler: T): T {
  return async function* (...args: Parameters<T>): AsyncGenerator<Awaited<ReturnType<T>>> {
    try {
      yield* handler(...args)
    } catch (err) {
      throw toConnectError(err)
    }
  } as T
}
