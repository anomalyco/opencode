import { formatPath } from "../util/path-format"
import { useLocation } from "./location"
import { useTuiPaths } from "./runtime"

export function usePathFormatter() {
  const paths = useTuiPaths()
  const location = useLocation()
  return {
    path: () => location.current?.directory || paths.cwd,
    format: (input?: string) => formatPath(input, { base: location.current?.directory || paths.cwd, home: paths.home }),
  }
}
