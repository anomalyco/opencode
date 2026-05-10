import path from "path"
import { createContext, useContext, type ParentProps } from "solid-js"
import { Global } from "@opencode-ai/core/global"

const context = createContext<{
  path: () => string
  format: (input?: string) => string
}>()

export function PathFormatterProvider(props: ParentProps<{ path: string | undefined }>) {
  return (
    <context.Provider value={{ path: () => props.path || process.cwd(), format: (input) => formatPath(input, props.path) }}>
      {props.children}
    </context.Provider>
  )
}

export function usePathFormatter() {
  const value = useContext(context)
  if (!value) throw new Error("PathFormatter context must be used within a PathFormatterProvider")
  return value
}

function formatPath(input: string | undefined, base: string | undefined) {
  if (!input) return ""

  const root = base || process.cwd()
  const absolute = path.isAbsolute(input) ? input : path.resolve(root, input)
  const relative = path.relative(root, absolute)

  if (!relative) return "."
  if (relative !== ".." && !relative.startsWith(".." + path.sep)) return relative
  if (Global.Path.home && (absolute === Global.Path.home || absolute.startsWith(Global.Path.home + path.sep))) {
    return absolute.replace(Global.Path.home, "~")
  }
  return absolute
}
