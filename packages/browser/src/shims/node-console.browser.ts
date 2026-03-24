export interface BrowserConsoleOptions {
  stdout?: { write?: (chunk: string) => void }
  stderr?: { write?: (chunk: string) => void }
}

export class Console {
  private readonly stdout?: { write?: (chunk: string) => void }
  private readonly stderr?: { write?: (chunk: string) => void }

  constructor(options: BrowserConsoleOptions = {}) {
    this.stdout = options.stdout
    this.stderr = options.stderr
  }

  public log(...args: unknown[]): void {
    this.write(this.stdout, args)
  }

  public info(...args: unknown[]): void {
    this.write(this.stdout, args)
  }

  public warn(...args: unknown[]): void {
    this.write(this.stderr ?? this.stdout, args)
  }

  public error(...args: unknown[]): void {
    this.write(this.stderr ?? this.stdout, args)
  }

  public debug(...args: unknown[]): void {
    this.write(this.stdout, args)
  }

  private write(target: { write?: (chunk: string) => void } | undefined, args: unknown[]): void {
    const message = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ")
    if (target?.write) {
      target.write(`${message}\n`)
      return
    }

    globalThis.console.log(message)
  }
}

export default {
  Console,
}
