import z from "zod"
export declare namespace Log {
  const Level: z.ZodEnum<{
    DEBUG: "DEBUG"
    ERROR: "ERROR"
    INFO: "INFO"
    WARN: "WARN"
  }>
  type Level = z.infer<typeof Level>
  type Logger = {
    debug(message?: any, extra?: Record<string, any>): void
    info(message?: any, extra?: Record<string, any>): void
    error(message?: any, extra?: Record<string, any>): void
    warn(message?: any, extra?: Record<string, any>): void
    tag(key: string, value: string): Logger
    clone(): Logger
    time(
      message: string,
      extra?: Record<string, any>,
    ): {
      stop(): void
      [Symbol.dispose](): void
    }
  }
  const Default: Logger
  interface Options {
    print: boolean
    dev?: boolean
    level?: Level
  }
  function file(): string
  function init(options: Options): Promise<void>
  function create(tags?: Record<string, any>): Logger
}
