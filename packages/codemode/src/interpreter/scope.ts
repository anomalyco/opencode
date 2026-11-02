import { type AstNode, type Binding, referenceError, typeError } from "./model.js"
import type { Value } from "./objects.js"
import { globalNames } from "./globals.js"

type UnavailableGlobal = {
  readonly message: string
  readonly suggestion: string
}

const unavailableGlobals: Readonly<Record<string, UnavailableGlobal>> = {
  process: {
    message:
      "'process' is unavailable: Code Mode has no Node.js runtime. Use the `shell` tool for environment, binaries and paths.",
    suggestion: "Use the `shell` tool for environment, binaries and paths.",
  },
  module: {
    message: "'module' is unavailable: Code Mode has no CommonJS module wrapper. Use imports or `require` for provided globals.",
    suggestion: "Use imports or `require` to load host-provided globals by module name.",
  },
  exports: {
    message: "'exports' is unavailable: Code Mode has no CommonJS module wrapper. Return values or use supported imports.",
    suggestion: "Return values instead of assigning to CommonJS exports.",
  },
  Buffer: {
    message: "'Buffer' is unavailable: Code Mode has no Node.js runtime. Use TextEncoder, TextDecoder or Uint8Array.",
    suggestion: "Use TextEncoder, TextDecoder or Uint8Array.",
  },
  __dirname: {
    message: "'__dirname' is unavailable: Code Mode has no Node.js filesystem runtime. Use the `shell` tool for paths.",
    suggestion: "Use the `shell` tool for paths.",
  },
  __filename: {
    message:
      "'__filename' is unavailable: Code Mode has no Node.js filesystem runtime. Use the `shell` tool for paths.",
    suggestion: "Use the `shell` tool for paths.",
  },
  global: {
    message: "'global' is unavailable: Code Mode has no Node.js runtime. Use the supported Code Mode globals directly.",
    suggestion: "Use the supported Code Mode globals directly.",
  },
  globalThis: {
    message: "'globalThis' is unavailable: Code Mode exposes only its supported globals. Use those globals directly.",
    suggestion: "Use the supported Code Mode globals directly.",
  },
  window: {
    message: "'window' is unavailable: Code Mode is not a browser and has no DOM. Use the available tools instead.",
    suggestion: "Use the available tools instead of browser globals.",
  },
  document: {
    message: "'document' is unavailable: Code Mode is not a browser and has no DOM. Use the available tools instead.",
    suggestion: "Use the available tools instead of browser DOM APIs.",
  },
  eval: {
    message: "Dynamic code evaluation is disabled in Code Mode; write the code inline.",
    suggestion: "Write the code inline instead of evaluating a string.",
  },
  setTimeout: {
    message:
      "'setTimeout' is unavailable: Code Mode has no timers or sleep. Await your calls, and do waiting in the `shell` tool.",
    suggestion: "Await your calls, and do waiting in the `shell` tool.",
  },
  setInterval: {
    message:
      "'setInterval' is unavailable: Code Mode has no timers or sleep. Await your calls and use the `shell` tool.",
    suggestion: "Await your calls and use the `shell` tool instead of timers.",
  },
  setImmediate: {
    message:
      "'setImmediate' is unavailable: Code Mode has no timers or sleep. Await your calls and use the `shell` tool.",
    suggestion: "Await your calls and use the `shell` tool instead of timers.",
  },
  queueMicrotask: {
    message: "'queueMicrotask' is unavailable: Code Mode has no timers or scheduling APIs. Await your calls instead.",
    suggestion: "Await your calls instead of scheduling a microtask.",
  },
  Deno: {
    message: "'Deno' is unavailable: Code Mode is not a Deno runtime. Use the available tools instead.",
    suggestion: "Use the available tools instead of Deno APIs.",
  },
  Bun: {
    message: "'Bun' is unavailable: Code Mode is not a Bun runtime. Use the available tools instead.",
    suggestion: "Use the available tools instead of Bun APIs.",
  },
  Intl: {
    message:
      "'Intl' is unavailable: Code Mode does not provide this host global. Use the supported data builtins instead.",
    suggestion: "Use the supported data builtins instead.",
  },
  BigInt: {
    message: "'BigInt' is unavailable: Code Mode does not support BigInt values. Use Number where appropriate.",
    suggestion: "Use Number values where appropriate.",
  },
  ArrayBuffer: {
    message: "'ArrayBuffer' is unavailable: Code Mode does not provide this host global. Use Uint8Array instead.",
    suggestion: "Use Uint8Array instead.",
  },
  Blob: {
    message: "'Blob' is unavailable: Code Mode is not a browser and does not provide Blob. Use Uint8Array instead.",
    suggestion: "Use Uint8Array instead.",
  },
  Response: {
    message:
      "'Response' is unavailable: Code Mode does not provide the browser Response global. Use the result from `fetch` instead.",
    suggestion: "Use the result from `fetch` instead.",
  },
  AbortSignal: {
    message:
      "'AbortSignal' is unavailable: Code Mode does not provide this browser global. Use the available tools instead.",
    suggestion: "Use the available tools instead.",
  },
  performance: {
    message:
      "'performance' is unavailable: Code Mode does not provide this host global. Use the available tools instead.",
    suggestion: "Use the available tools instead.",
  },
  WeakRef: {
    message:
      "'WeakRef' is unavailable: Code Mode does not provide this host global. Use ordinary object references instead.",
    suggestion: "Use ordinary object references instead.",
  },
  DataView: {
    message: "'DataView' is unavailable: Code Mode does not provide this host global. Use Uint8Array instead.",
    suggestion: "Use Uint8Array instead.",
  },
  Int32Array: {
    message: "'Int32Array' is unavailable: Code Mode does not provide this host global. Use Uint8Array instead.",
    suggestion: "Use Uint8Array instead.",
  },
  Reflect: {
    message:
      "'Reflect' is unavailable: Code Mode does not provide this host global. Use supported object operations instead.",
    suggestion: "Use supported object operations instead.",
  },
  Proxy: {
    message: "'Proxy' is unavailable: Code Mode does not provide this host global. Use plain objects instead.",
    suggestion: "Use plain objects instead.",
  },
}

const unknownIdentifier = (name: string, node: AstNode) => {
  const unavailable =
    !globalNames.has(name) && Object.hasOwn(unavailableGlobals, name) ? unavailableGlobals[name] : undefined
  if (unavailable) return referenceError(unavailable.message, node, [unavailable.suggestion])
  return referenceError(`Unknown identifier '${name}'.`, node)
}

export class ScopeStack {
  private readonly scopes: Array<Map<string, Binding>>

  constructor(scopes: Array<Map<string, Binding>>) {
    this.scopes = scopes
  }

  reserve(name: string, mutable: boolean, node: AstNode): void {
    const scope = this.current()
    if (scope.has(name)) {
      throw typeError(`Identifier '${name}' has already been declared.`, node)
    }
    scope.set(name, { mutable, value: undefined, initialized: false })
  }

  initialize(name: string, value: Value, node: AstNode): void {
    const binding = this.current().get(name)
    if (!binding || binding.initialized !== false) {
      throw typeError(`Identifier '${name}' has not been reserved for initialization.`, node)
    }
    binding.value = value
    binding.initialized = true
  }

  declare(name: string, value: Value, mutable: boolean, node: AstNode): void {
    const scope = this.current()
    if (scope.has(name)) {
      throw typeError(`Identifier '${name}' has already been declared.`, node)
    }
    scope.set(name, { mutable, value, initialized: true })
  }

  get(name: string, node: AstNode): Value {
    const binding = this.resolve(name)

    if (!binding) {
      throw unknownIdentifier(name, node)
    }

    if (binding.initialized === false) {
      throw referenceError(`Cannot access '${name}' before initialization.`, node)
    }

    return binding.value
  }

  set(name: string, value: Value, node: AstNode): Value {
    const binding = this.resolve(name)

    if (!binding) {
      throw unknownIdentifier(name, node)
    }

    if (binding.initialized === false) {
      throw referenceError(`Cannot access '${name}' before initialization.`, node)
    }

    if (!binding.mutable) {
      throw typeError(`Cannot assign to constant '${name}'.`, node)
    }

    binding.value = value
    return value
  }

  resolve(name: string): Binding | undefined {
    for (let index = this.scopes.length - 1; index >= 0; index -= 1) {
      const scope = this.scopes[index]
      const binding = scope?.get(name)

      if (binding) {
        return binding
      }
    }

    return undefined
  }

  current(): Map<string, Binding> {
    const scope = this.scopes[this.scopes.length - 1]

    if (!scope) {
      throw typeError("Interpreter scope stack is empty.")
    }

    return scope
  }

  push(scope: Map<string, Binding> = new Map()): void {
    this.scopes.push(scope)
  }

  pop(): void {
    this.scopes.pop()
  }

  capture(): Array<Map<string, Binding>> {
    return this.scopes.slice()
  }
}
