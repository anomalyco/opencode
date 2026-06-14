export namespace Log {
  type Fields = Record<string, unknown>

  export function create(baseFields: Fields = {}) {
    const fields: Fields = { ...baseFields }

    const api = {
      info(message?: unknown, extra: Fields = {}) {
        emit("info", message, extra)
        return api
      },
      warn(message?: unknown, extra: Fields = {}) {
        emit("warn", message, extra)
        return api
      },
      error(message?: unknown, extra: Fields = {}) {
        emit("error", message, extra)
        return api
      },
      tag(key: string, value: string) {
        fields[key] = value
        return api
      },
      clone() {
        return create(fields)
      },
    }

    function emit(level: "info" | "warn" | "error", message?: unknown, extra: Fields = {}) {
      const merged = { ...fields, ...extra }
      const prefix = Object.entries(merged)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" ")
      const line = prefix ? `${prefix} ${String(message ?? "")}` : String(message ?? "")
      if (level === "error") {
        console.error(line)
      } else if (level === "warn") {
        console.warn(line)
      } else {
        console.info(line)
      }
    }

    return api
  }
}
