declare module "bun" {
  type ShellExpression =
    | { toString(): string }
    | Array<ShellExpression>
    | string
    | { raw: string }
    | Subprocess<SpawnOptions.Writable, SpawnOptions.Readable, SpawnOptions.Readable>
    | SpawnOptions.Readable
    | SpawnOptions.Writable
    | ReadableStream;

  /**
   * The [Bun shell](https://bun.com/docs/runtime/shell) is a powerful tool for running shell commands.
   *
   * @example
   * ```ts
   * const result = await $`echo "Hello, world!"`.text();
   * console.log(result); // "Hello, world!"
   * ```
   *
   * @category Process Management
   */
  function $(strings: TemplateStringsArray, ...expressions: ShellExpression[]): $.ShellPromise;

  type $ = typeof $;

  namespace $ {
    /**
     * Perform bash-like brace expansion on the given pattern.
     * @param pattern - Brace pattern to expand
     *
     * @example
     * ```js
     * const result = braces('index.{js,jsx,ts,tsx}');
     * console.log(result) // ['index.js', 'index.jsx', 'index.ts', 'index.tsx']
     * ```
     */
    function braces(pattern: string): string[];

    /**
     * Escape strings for input into shell commands.
     * @param input
     */
    function escape(input: string): string;

    /**
     *
     * Change the default environment variables for shells created by this instance.
     *
     * @param newEnv Default environment variables to use for shells created by this instance.
     * @default process.env
     *
     * @example
     * ```js
     * import {$} from 'bun';
     * $.env({ BUN: "bun" });
     * await $`echo $BUN`;
     * // "bun"
     * ```
     */
    function env(newEnv?: Record<string, string | undefined> | NodeJS.Dict<string> | undefined): $;

    /**
     *
     * @param newCwd Default working directory to use for shells created by this instance.
     */
    function cwd(newCwd?: string): $;

    /**
     * Configure the shell to not throw an exception on non-zero exit codes.
     */
    function nothrow(): $;

    /**
     * Configure whether or not the shell should throw an exception on non-zero exit codes.
     */
    function throws(shouldThrow: boolean): $;

    /**
     * The `Bun.$.ShellPromise` class represents a shell command that gets executed
     * once awaited, or called with `.text()`, `.json()`, etc.
     *
     * @example
     * ```ts
     * const myShellPromise = $`echo "Hello, world!"`;
     * const result = await myShellPromise.text();
     * console.log(result); // "Hello, world!"
     * ```
     */
    class ShellPromise extends Promise<ShellOutput> {
      get stdin(): WritableStream;

      /**
       * Change the current working directory of the shell.
       * @param newCwd - The new working directory
       */
      cwd(newCwd: string): this;

      /**
       * Set environment variables for the shell.
       * @param newEnv - The new environment variables
       *
       * @example
       * ```ts
       * await $`echo $FOO`.env({ ...process.env, FOO: "LOL!" })
       * expect(stdout.toString()).toBe("LOL!");
       * ```
       */
      env(newEnv: Record<string, string | undefined> | NodeJS.Dict<string> | undefined): this;

      /**
       * By default, the shell will write to the current process's stdout and stderr, as well as buffering that output.
       *
       * This configures the shell to only buffer the output.
       * @param isQuiet - Whether to suppress output. Defaults to true.
       */
      quiet(isQuiet?: boolean): this;

      /**
       * Read from stdout as a string, line by line
       *
       * Automatically calls {@link quiet} to disable echoing to stdout.
       */
      lines(): AsyncIterable<string>;

      /**
       * Read from stdout as a string.
       *
       * Automatically calls {@link quiet} to disable echoing to stdout.
       *
       * @param encoding - The encoding to use when decoding the output
       * @returns A promise that resolves with stdout as a string
       *
       * @example
       * **Read as UTF-8 string**
       * ```ts
       * const output = await $`echo hello`.text();
       * console.log(output); // "hello\n"
       * ```
       *
       * **Read as base64 string**
       * ```ts
       * const output = await $`echo ${atob("hello")}`.text("base64");
       * console.log(output); // "hello\n"
       * ```
       */
      text(encoding?: BufferEncoding): Promise<string>;

      /**
       * Read from stdout as a JSON object
       *
       * Automatically calls {@link quiet}
       *
       * @returns A promise that resolves with stdout as a JSON object
       * @example
       *
       * ```ts
       * const output = await $`echo '{"hello": 123}'`.json();
       * console.log(output); // { hello: 123 }
       * ```
       *
       */
      json(): Promise<any>;

      /**
       * Read from stdout as an ArrayBuffer
       *
       * Automatically calls {@link quiet}
       * @returns A promise that resolves with stdout as an ArrayBuffer
       * @example
       *
       * ```ts
       * const output = await $`echo hello`.arrayBuffer();
       * console.log(output); // ArrayBuffer { byteLength: 6 }
       * ```
       */
      arrayBuffer(): Promise<ArrayBuffer>;

      /**
       * Read from stdout as a Blob
       *
       * Automatically calls {@link quiet}
       * @returns A promise that resolves with stdout as a Blob
       * @example
       * ```ts
       * const output = await $`echo hello`.blob();
       * console.log(output); // Blob { size: 6, type: "" }
       * ```
       */
      blob(): Promise<Blob>;

      /**
       * Configure the shell to not throw an exception on non-zero exit codes. Throwing can be re-enabled with `.throws(true)`.
       *
       * By default, the shell with throw an exception on commands which return non-zero exit codes.
       */
      nothrow(): this;

      /**
       * Configure whether or not the shell should throw an exception on non-zero exit codes.
       *
       * By default, this is configured to `true`.
       */
      throws(shouldThrow: boolean): this;
    }

    /**
     * ShellError represents an error that occurred while executing a shell command with [the Bun Shell](https://bun.com/docs/runtime/shell).
     *
     * @example
     * ```ts
     * try {
     *   const result = await $`exit 1`;
     * } catch (error) {
     *   if (error instanceof $.ShellError) {
     *     console.log(error.exitCode); // 1
     *   }
     * }
     * ```
     */
    class ShellError extends Error implements ShellOutput {
      readonly stdout: Buffer;
      readonly stderr: Buffer;
      readonly exitCode: number;

      /**
       * Read from stdout as a string
       *
       * @param encoding - The encoding to use when decoding the output
       * @returns Stdout as a string with the given encoding
       *
       * @example
       * **Read as UTF-8 string**
       * ```ts
       * const output = await $`echo hello`;
       * console.log(output.text()); // "hello\n"
       * ```
       *
       * **Read as base64 string**
       * ```ts
       * const output = await $`echo ${atob("hello")}`;
       * console.log(output.text("base64")); // "hello\n"
       * ```
       */
      text(encoding?: BufferEncoding): string;

      /**
       * Read from stdout as a JSON object
       *
       * @returns Stdout as a JSON object
       * @example
       *
       * ```ts
       * const output = await $`echo '{"hello": 123}'`;
       * console.log(output.json()); // { hello: 123 }
       * ```
       *
       */
      json(): any;

      /**
       * Read from stdout as an ArrayBuffer
       *
       * @returns Stdout as an ArrayBuffer
       * @example
       *
       * ```ts
       * const output = await $`echo hello`;
       * console.log(output.arrayBuffer()); // ArrayBuffer { byteLength: 6 }
       * ```
       */
      arrayBuffer(): ArrayBuffer;

      /**
       * Read from stdout as a Blob
       *
       * @returns Stdout as a blob
       * @example
       * ```ts
       * const output = await $`echo hello`;
       * console.log(output.blob()); // Blob { size: 6, type: "" }
       * ```
       */
      blob(): Blob;

      /**
       * Read from stdout as an Uint8Array
       *
       * @returns Stdout as an Uint8Array
       * @example
       *```ts
       * const output = await $`echo hello`;
       * console.log(output.bytes()); // Uint8Array { byteLength: 6 }
       * ```
       */
      bytes(): Uint8Array<ArrayBuffer>;
    }

    interface ShellOutput {
      readonly stdout: Buffer;
      readonly stderr: Buffer;
      readonly exitCode: number;

      /**
       * Read from stdout as a string
       *
       * @param encoding - The encoding to use when decoding the output
       * @returns Stdout as a string with the given encoding
       *
       * @example
       * **Read as UTF-8 string**
       * ```ts
       * const output = await $`echo hello`;
       * console.log(output.text()); // "hello\n"
       * ```
       *
       * **Read as base64 string**
       * ```ts
       * const output = await $`echo ${atob("hello")}`;
       * console.log(output.text("base64")); // "hello\n"
       * ```
       */
      text(encoding?: BufferEncoding): string;

      /**
       * Read from stdout as a JSON object
       *
       * @returns Stdout as a JSON object
       * @example
       *
       * ```ts
       * const output = await $`echo '{"hello": 123}'`;
       * console.log(output.json()); // { hello: 123 }
       * ```
       *
       */
      json(): any;

      /**
       * Read from stdout as an ArrayBuffer
       *
       * @returns Stdout as an ArrayBuffer
       * @example
       *
       * ```ts
       * const output = await $`echo hello`;
       * console.log(output.arrayBuffer()); // ArrayBuffer { byteLength: 6 }
       * ```
       */
      arrayBuffer(): ArrayBuffer;

      /**
       * Read from stdout as an Uint8Array
       *
       * @returns Stdout as an Uint8Array
       * @example
       *
       * ```ts
       * const output = await $`echo hello`;
       * console.log(output.bytes()); // Uint8Array { byteLength: 6 }
       * ```
       */
      bytes(): Uint8Array<ArrayBuffer>;

      /**
       * Read from stdout as a Blob
       *
       * @returns Stdout as a blob
       * @example
       * ```ts
       * const output = await $`echo hello`;
       * console.log(output.blob()); // Blob { size: 6, type: "" }
       * ```
       */
      blob(): Blob;
    }

    const Shell: new () => $;
  }
}
