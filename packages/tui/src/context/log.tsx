import { createContext, useContext, type ParentProps } from "solid-js"

export type LogLevel = "debug" | "info" | "warn" | "error"
export type LogTags = Readonly<Record<string, unknown>>
export type LogSink = (level: LogLevel, message: string, tags: LogTags) => void

const LogContext = createContext<LogSink>()

export function LogProvider(props: ParentProps<{ log: LogSink }>) {
  return <LogContext.Provider value={props.log}>{props.children}</LogContext.Provider>
}

export function useLog(tags: LogTags = {}) {
  const sink = useContext(LogContext)
  if (!sink) throw new Error("Log context must be used within a LogProvider")

  const write = (level: LogLevel, message: string, extra: LogTags = {}) => sink(level, message, { ...tags, ...extra })
  return {
    debug: (message: string, extra?: LogTags) => write("debug", message, extra),
    info: (message: string, extra?: LogTags) => write("info", message, extra),
    warn: (message: string, extra?: LogTags) => write("warn", message, extra),
    error: (message: string, extra?: LogTags) => write("error", message, extra),
  }
}
