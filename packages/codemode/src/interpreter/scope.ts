import { type AstNode, type Binding, InterpreterRuntimeError } from "./model.js"

// Binding maps searched innermost-first; closures capture() the stack and function
// invocation rebuilds one from the captured scopes.
export class ScopeStack {
  private readonly scopes: Array<Map<string, Binding>>

  constructor(scopes: Array<Map<string, Binding>>) {
    this.scopes = scopes
  }

  declare(name: string, value: unknown, mutable: boolean, node: AstNode): void {
    const scope = this.current()

    // A pre-seeded parameter slot (initialized === false) is being bound for the first time;
    // anything else already present is a genuine duplicate declaration.
    const existing = scope.get(name)
    if (existing && existing.initialized !== false) {
      throw new InterpreterRuntimeError(`Identifier '${name}' has already been declared.`, node)
    }

    scope.set(name, { mutable, value, initialized: true })
  }

  get(name: string, node: AstNode): unknown {
    const binding = this.resolve(name)

    if (!binding) {
      throw new InterpreterRuntimeError(`Unknown identifier '${name}'.`, node).as("ReferenceError")
    }

    // A parameter default that forward-references a later (not-yet-bound) parameter - JS TDZ.
    if (binding.initialized === false) {
      throw new InterpreterRuntimeError(`Cannot access '${name}' before initialization.`, node).as("ReferenceError")
    }

    return binding.value
  }

  set(name: string, value: unknown, node: AstNode): unknown {
    const binding = this.resolve(name)

    if (!binding) {
      throw new InterpreterRuntimeError(`Unknown identifier '${name}'.`, node).as("ReferenceError")
    }

    if (!binding.mutable) {
      throw new InterpreterRuntimeError(`Cannot assign to constant '${name}'.`, node).as("TypeError")
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
      throw new InterpreterRuntimeError("Interpreter scope stack is empty.")
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
