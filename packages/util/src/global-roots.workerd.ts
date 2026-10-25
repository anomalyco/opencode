import os from "os"
import path from "path"

// workerd has no home directory or XDG base dirs and only tmp is writable, so
// every global path roots under one directory there. Nothing durable lives in
// these: on workerd the database is on Durable Object storage.
export function roots(app: string) {
  const root = path.join(os.tmpdir(), app)
  return {
    data: path.join(root, "data"),
    cache: path.join(root, "cache"),
    config: path.join(root, "config"),
    state: path.join(root, "state"),
    tmp: path.join(root, "tmp"),
  }
}
