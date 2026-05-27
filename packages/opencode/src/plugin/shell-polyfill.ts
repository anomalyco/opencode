import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import type { BunShell, BunShellPromise, BunShellOutput } from "@opencode-ai/plugin/shell"

const execFileAsync = promisify(execFile)

type ShellConfig = {
  env?: Record<string, string | undefined>
  cwd?: string
  throws?: boolean
  quiet?: boolean
}

class ShellPromise implements BunShellPromise {
  private command: string
  private config: ShellConfig
  private promise: Promise<BunShellOutput> | null = null

  constructor(command: string, config: ShellConfig) {
    this.command = command
    this.config = { ...config }
  }

  private getPromise(): Promise<BunShellOutput> {
    if (this.promise) return this.promise

    this.promise = new Promise<BunShellOutput>((resolve, reject) => {
      const env = { ...process.env, ...this.config.env }
      const cwd = this.config.cwd || process.cwd()
      const shouldThrow = this.config.throws !== false

      // Use sh/bash to execute the command
      const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh"
      const shellFlag = process.platform === "win32" ? "/c" : "-c"

      const child = spawn(shell, [shellFlag, this.command], {
        env,
        cwd,
        stdio: this.config.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
      })

      let stdout = Buffer.alloc(0)
      let stderr = Buffer.alloc(0)

      if (child.stdout) {
        child.stdout.on("data", (chunk) => {
          stdout = Buffer.concat([stdout, chunk])
          if (!this.config.quiet) {
            process.stdout.write(chunk)
          }
        })
      }

      if (child.stderr) {
        child.stderr.on("data", (chunk) => {
          stderr = Buffer.concat([stderr, chunk])
          if (!this.config.quiet) {
            process.stderr.write(chunk)
          }
        })
      }

      child.on("error", (error) => {
        reject(error)
      })

      child.on("close", (exitCode) => {
        const output: BunShellOutput = {
          stdout,
          stderr,
          exitCode: exitCode ?? 0,
          text: (encoding?: BufferEncoding) => stdout.toString(encoding || "utf8"),
          json: () => JSON.parse(stdout.toString("utf8")),
          arrayBuffer: () => stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength),
          bytes: () => new Uint8Array(stdout),
          blob: () => new Blob([stdout]),
        }

        if (exitCode !== 0 && shouldThrow) {
          const error = new Error(`Command failed with exit code ${exitCode}`) as any
          Object.assign(error, output)
          reject(error)
        } else {
          resolve(output)
        }
      })
    })

    return this.promise
  }

  then<TResult1 = BunShellOutput, TResult2 = never>(
    onfulfilled?: ((value: BunShellOutput) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.getPromise().then(onfulfilled, onrejected)
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
  ): Promise<BunShellOutput | TResult> {
    return this.getPromise().catch(onrejected)
  }

  finally(onfinally?: (() => void) | null): Promise<BunShellOutput> {
    return this.getPromise().finally(onfinally)
  }

  get [Symbol.toStringTag]() {
    return "ShellPromise"
  }

  get stdin(): WritableStream {
    throw new Error("stdin is not supported in shell polyfill")
  }

  cwd(newCwd: string): this {
    this.config.cwd = newCwd
    return this
  }

  env(newEnv: Record<string, string> | undefined): this {
    this.config.env = { ...this.config.env, ...newEnv }
    return this
  }

  quiet(): this {
    this.config.quiet = true
    return this
  }

  async *lines(): AsyncIterable<string> {
    const result = await this.getPromise()
    const text = result.stdout.toString("utf8")
    for (const line of text.split("\n")) {
      yield line
    }
  }

  async text(encoding?: BufferEncoding): Promise<string> {
    const result = await this.getPromise()
    return result.stdout.toString(encoding || "utf8")
  }

  async json(): Promise<any> {
    const result = await this.getPromise()
    return JSON.parse(result.stdout.toString("utf8"))
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const result = await this.getPromise()
    return result.stdout.buffer.slice(result.stdout.byteOffset, result.stdout.byteOffset + result.stdout.byteLength)
  }

  async blob(): Promise<Blob> {
    const result = await this.getPromise()
    return new Blob([result.stdout])
  }

  nothrow(): this {
    this.config.throws = false
    return this
  }

  throws(shouldThrow: boolean): this {
    this.config.throws = shouldThrow
    return this
  }
}

class ShellPolyfill implements BunShell {
  private config: ShellConfig = {}

  constructor(config: ShellConfig = {}) {
    this.config = { ...config }
  }

  (strings: TemplateStringsArray, ...expressions: any[]): BunShellPromise {
    // Construct the command from template literal
    let command = strings[0]
    for (let i = 0; i < expressions.length; i++) {
      const expr = expressions[i]
      const value = Array.isArray(expr) ? expr.join(" ") : String(expr)
      command += value + strings[i + 1]
    }

    return new ShellPromise(command, this.config)
  }

  braces(pattern: string): string[] {
    // Basic brace expansion - not full bash implementation
    // This is a simplified version; full implementation would be complex
    const match = pattern.match(/^([^{]*)\\{([^}]+)\\}(.*)$/)
    if (!match) return [pattern]

    const [, prefix, braceContent, suffix] = match
    const parts = braceContent.split(",")
    return parts.map((part) => prefix + part + suffix)
  }

  escape(input: string): string {
    // Shell escape for Unix-like systems
    if (process.platform === "win32") {
      return `"${input.replace(/"/g, '\\"')}"`
    }
    return `'${input.replace(/'/g, "'\\''")}'`
  }

  env(newEnv?: Record<string, string | undefined>): BunShell {
    return new ShellPolyfill({ ...this.config, env: { ...this.config.env, ...newEnv } }) as any
  }

  cwd(newCwd?: string): BunShell {
    return new ShellPolyfill({ ...this.config, cwd: newCwd }) as any
  }

  nothrow(): BunShell {
    return new ShellPolyfill({ ...this.config, throws: false }) as any
  }

  throws(shouldThrow: boolean): BunShell {
    return new ShellPolyfill({ ...this.config, throws: shouldThrow }) as any
  }
}

export function createShellPolyfill(): BunShell {
  const polyfill = new ShellPolyfill()
  const fn = polyfill.bind(polyfill) as any
  Object.setPrototypeOf(fn, ShellPolyfill.prototype)
  Object.assign(fn, polyfill)
  return fn as BunShell
}
