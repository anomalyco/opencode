import path from "path"
import { abbreviateHome } from "../runtime"
import { useLocation } from "./location"
import { useTuiPaths } from "./runtime"

export function usePathFormatter() {
  const paths = useTuiPaths()
  const location = useLocation()
  return {
    path: () => location()?.directory || paths.cwd,
    format: (input?: string) => formatPath(input, location()?.directory || paths.cwd, paths.home),
  }
}

function formatPath(input: string | undefined, base: string, home: string) {
  if (typeof input !== "string" || !input) return ""

  const absolute = path.isAbsolute(input) ? input : path.resolve(base, input)
  const relative = path.relative(base, absolute)

  if (!relative) return "."
  if (relative !== ".." && !relative.startsWith(".." + path.sep)) return relative
  return abbreviateHome(absolute, home)
}
