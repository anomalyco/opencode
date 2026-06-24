import vm from "node:vm"
import type { SandboxResult } from "./types"

const DEFAULT_TIMEOUT_MS = 1000
const DEFAULT_MEMORY_MB = 16
const DEFAULT_OUTPUT_KB = 4

export interface SandboxLimits {
  timeoutMs: number
  maxMemoryMB: number
  maxOutputBytes: number
}

export class DualIsolateSandbox {
  private limits: SandboxLimits

  constructor(limits?: Partial<SandboxLimits>) {
    this.limits = {
      timeoutMs: limits?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxMemoryMB: limits?.maxMemoryMB ?? DEFAULT_MEMORY_MB,
      maxOutputBytes: limits?.maxOutputBytes ?? DEFAULT_OUTPUT_KB * 1024,
    }
  }

  execute(code: string, args: unknown[], expected: unknown): SandboxResult {
    if (this.isWasmBytes(code))
      return this.executeWasm(code, args, expected)
    return this.executeVm(code, args, expected)
  }

  private isWasmBytes(code: string): boolean {
    // WASM magic bytes: \0asm (0x00 0x61 0x73 0x6D)
    return code.length >= 4 && code.charCodeAt(0) === 0 && code.charCodeAt(1) === 97 && code.charCodeAt(2) === 115 && code.charCodeAt(3) === 109
  }

  private executeWasm(bytes: string, args: unknown[], expected: unknown): SandboxResult {
    try {
      const byteArray = new Uint8Array(bytes.length)
      for (let i = 0; i < bytes.length; i++) byteArray[i] = bytes.charCodeAt(i)

      const module = new WebAssembly.Module(byteArray)
      const instance = new WebAssembly.Instance(module)
      const exports = instance.exports as Record<string, CallableFunction>

      // Find and call the first exported function
      const fnName = Object.keys(exports).find((k) => typeof exports[k] === "function")
      if (!fnName) return { passed: false, actual: null, expected, error: "No exported function found in WASM module" }

      const result = (exports[fnName] as CallableFunction)(...args)
      const actual = typeof result === "number" ? result : Number(result)

      return {
        passed: actual === expected,
        actual,
        expected,
        error: actual !== expected ? `Result ${actual} ≠ expected ${expected}` : undefined,
      }
    } catch (err) {
      return { passed: false, actual: null, expected, error: `WASM execution error: ${(err as Error).message}` }
    }
  }

  private executeVm(fnCode: string, args: unknown[], expected: unknown): SandboxResult {
    try {
      const sandbox = {}
      const context = vm.createContext(sandbox)

      const wrappedCode = `
        "use strict";
        const fn = (${fnCode});
        const args = ${JSON.stringify(args)};
        const result = fn.apply(null, args);
        result;
      `

      const script = new vm.Script(wrappedCode)
      const actual = script.runInContext(context, { timeout: this.limits.timeoutMs, breakOnSigint: true })

      return {
        passed: actual === expected,
        actual,
        expected,
        error: actual !== expected ? `Result ${JSON.stringify(actual)} ≠ expected ${JSON.stringify(expected)}` : undefined,
      }
    } catch (err) {
      return { passed: false, actual: null, expected, error: `VM execution error: ${(err as Error).message}` }
    }
  }
}
