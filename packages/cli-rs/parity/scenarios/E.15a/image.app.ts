// An image card in the diff viewer (F15, `DiffViewerImage`): the full-screen route reads the working-tree image
// with `file.read`, shows it with its size and "Click to enlarge", and a click opens it in the image preview dialog
// (DLG09) under the file's name. Escape closes the dialog.
import { defineApp } from "../../lib/app"

// An 8 x 4 PNG, red on the left and blue on the right.
const png = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAFUlEQVR42mO4Y2MDRzZRd+CIgXoSAKBcLGFZ7ECVAAAAAElFTkSuQmCC"

const here = {
  directory: "/tmp/opencode/packages/tui",
  project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" },
}

export default defineApp({
  width: 100,
  height: 30,
  config: { experimental: { "new-designs": true } },
  routes: [
    { path: "/api/vcs/base", json: { location: here, data: { name: "main", ref: "main", source: "default" } } },
    {
      path: "/api/vcs/diff",
      json: {
        location: here,
        data: [{ file: "assets/logo.png", patch: "", additions: 0, deletions: 0, status: "added" }],
      },
    },
    { path: "/api/fs/read/assets/logo.png", base64: png, headers: { "content-type": "image/png" } },
  ],
  steps: [
    {
      checkpoint: "home",
      until: "Ask anything",
      masks: [
        {
          x: 14,
          y: 16,
          width: 86,
          height: 1,
          reason: "the placeholder: random in TS, not drawn yet in Rust (T17-home-prompt)",
        },
      ],
    },
    { type: "/diff" },
    { keys: ["enter"] },
    { checkpoint: "open", until: "Click to enlarge" },
    { click: [85, 13] },
    { checkpoint: "preview", until: "Image 1 of 1" },
    { keys: ["escape"] },
    { checkpoint: "closed", until: "Click to enlarge" },
  ],
})
