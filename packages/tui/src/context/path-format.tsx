import path from "path"
import { createContext, useContext, type ParentProps } from "solid-js"
import { abbreviateHome } from "../runtime"
import { useTuiPaths } from "./runtime"

const context = createContext<{
  path: () => string
  format: (input?: string) => string
}>()

export function PathFormatterProvider(props: ParentProps<{ path: string | undefined }>) {
  const paths = useTuiPaths()
  return (
    <context.Provider
      value={{
        path: () => props.path || paths.cwd,
        format: (input) => formatPath(input, props.path || paths.cwd, paths.home),
      }}
    >
      {props.children}
    </context.Provider>
  )
}

export function usePathFormatter() {
  const value = useContext(context)
  if (!value) throw new Error("PathFormatter context must be used within a PathFormatterProvider")
  return value
}

function formatPath(input: string | undefined, base: string, home: string) {
  if (typeof input !== "string" || !input) return ""

  const absolute = path.isAbsolute(input) ? input : path.resolve(base, input)
  const relative = path.relative(base, absolute)

  if (!relative) return "."
  if (relative !== ".." && !relative.startsWith(".." + path.sep)) return relative
  return abbreviateHome(absolute, home)
}
