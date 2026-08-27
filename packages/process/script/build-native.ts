import path from "node:path"
import { existsSync } from "node:fs"

if (process.platform !== "win32") throw new Error("This local proof currently supports Windows only")
const headers = process.argv[2] ?? process.env.NODE_API_HEADERS
if (!headers || !existsSync(path.join(headers, "node_api.h"))) {
  throw new Error("Pass the Node include directory: bun run build:native <path-to-include/node>")
}

const root = path.resolve(import.meta.dirname, "..")
const build = Bun.spawn(
  [
    "zig",
    "c++",
    "-shared",
    "-std=c++17",
    "-O2",
    "-Wno-nullability-completeness",
    "-DNAPI_VERSION=8",
    "-DNODE_GYP_MODULE_NAME=process_capture",
    `-I${headers}`,
    path.join(root, "native/capture.win32.cpp"),
    "-o",
    path.join(root, "native/capture.win32.node"),
    "-lkernel32",
  ],
  { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
)
if (await build.exited) process.exit(1)
const fixture = Bun.spawn(
  [
    "zig",
    "c++",
    "-std=c++17",
    "-O2",
    "-Wno-nullability-completeness",
    "-municode",
    path.join(root, "test/cancelled-writer.cpp"),
    "-o",
    path.join(root, "native/cancelled-writer.exe"),
    "-lkernel32",
  ],
  { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
)
process.exitCode = await fixture.exited
