type Fields = Record<string, unknown>

function write(level: "debug" | "info" | "warn" | "error", message: string, fields?: Fields) {
  const line = fields ? [message, fields] : [message]
  if (level === "error") {
    console.error(...line)
    return
  }
  if (level === "warn") {
    console.warn(...line)
    return
  }
  if (level === "debug") {
    console.debug(...line)
    return
  }
  console.info(...line)
}

export namespace Log {
  export function create(fields: Fields = {}) {
    return {
      debug(message: string, next?: Fields) {
        write("debug", message, { ...fields, ...next })
      },
      info(message: string, next?: Fields) {
        write("info", message, { ...fields, ...next })
      },
      warn(message: string, next?: Fields) {
        write("warn", message, { ...fields, ...next })
      },
      error(message: string, next?: Fields) {
        write("error", message, { ...fields, ...next })
      },
      time(message: string, next?: Fields) {
        const started = Date.now()
        return {
          stop(extra?: Fields) {
            write("debug", message, { ...fields, ...next, ...extra, duration: Date.now() - started })
          },
        }
      },
    }
  }

  export const Default = create()
}
