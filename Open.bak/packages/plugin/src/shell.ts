export type ShellFunction = (input: Uint8Array) => Uint8Array

export type ShellExpression =
  | { toString(): string }
  | Array<ShellExpression>
  | string
  | { raw: string }
  | ReadableStream

export interface BunShell {
  (strings: TemplateStringsArray, ...expressions: ShellExpression[]): BunShellPromise

  /**
   * Perform bash-like brace expansion on the given pattern.
   * @param pattern - Brace pattern to expand
   */
  braces(pattern: string): string[]

  /**
   * Escape strings for input into shell commands.
   */
  escape(input: string): string

  /**
   * Change the default environment variables for shells created by this instance.
   */
  env(newEnv?: Record<string, string | undefined>): BunShell

  /**
   * Default working directory to use for shells created by this instance.
   */
  cwd(newCwd?: string): BunShell

  /**
   * Configure the shell to not throw an exception on non-zero exit codes.
   */
  nothrow(): BunShell

  /**
   * Configure whether or not the shell should throw an exception on non-zero exit codes.
   */
  throws(shouldThrow: boolean): BunShell
}

export interface BunShellPromise extends Promise<BunShellOutput> {
  readonly stdin: WritableStream

  /**
   * Change the current working directory of the shell.
   */
  cwd(newCwd: string): this

  /**
   * Set environment variables for the shell.
   */
  env(newEnv: Record<string, string> | undefined): this

  /**
   * By default, the shell will write to the current process's stdout and stderr, as well as buffering that output.
   * This configures the shell to only buffer the output.
   */
  quiet(): this

  /**
   * Read from stdout as a string, line by line
   * Automatically calls quiet() to disable echoing to stdout.
   */
  lines(): AsyncIterable<string>

  /**
   * Read from stdout as a string.
   * Automatically calls quiet() to disable echoing to stdout.
   */
  text(encoding?: BufferEncoding): Promise<string>

  /**
   * Read from stdout as a JSON object
   * Automatically calls quiet()
   */
  json(): Promise<any>

  /**
   * Read from stdout as an ArrayBuffer
   * Automatically calls quiet()
   */
  arrayBuffer(): Promise<ArrayBuffer>

  /**
   * Read from stdout as a Blob
   * Automatically calls quiet()
   */
  blob(): Promise<Blob>

  /**
   * Configure the shell to not throw an exception on non-zero exit codes.
   */
  nothrow(): this

  /**
   * Configure whether or not the shell should throw an exception on non-zero exit codes.
   */
  throws(shouldThrow: boolean): this
}

export interface BunShellOutput {
  readonly stdout: Buffer
  readonly stderr: Buffer
  readonly exitCode: number

  /**
   * Read from stdout as a string
   */
  text(encoding?: BufferEncoding): string

  /**
   * Read from stdout as a JSON object
   */
  json(): any

  /**
   * Read from stdout as an ArrayBuffer
   */
  arrayBuffer(): ArrayBuffer

  /**
   * Read from stdout as an Uint8Array
   */
  bytes(): Uint8Array

  /**
   * Read from stdout as a Blob
   */
  blob(): Blob
}

export type BunShellError = Error & BunShellOutput
