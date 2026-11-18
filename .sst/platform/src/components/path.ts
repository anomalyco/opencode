import path from "path";

export function toPosix(p: string) {
  return p.split(path.sep).join(path.posix.sep);
}
