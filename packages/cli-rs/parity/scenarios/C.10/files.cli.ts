// `-f`: text files go inline in the prompt text, an image and a binary file as data URLs; one file
// is in a subdirectory.
import { defineCli } from "../../cli/run"
import { server, textStep } from "./fixture"

export default defineCli({
  args: ["run", "look", "-f", "notes.md", "-f", "pic.png", "--file", "sub/../data.bin", "-f", "latin.txt"],
  files: {
    "notes.md": "# Notes\nline two\n",
    "pic.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    "data.bin": new Uint8Array([0, 1, 2, 3, 250]),
    "latin.txt": new Uint8Array([0x68, 0xe9, 0x6c, 0x6c, 0x6f]),
    "sub/keep": "",
  },
  server: server({ events: () => textStep("Seen.") }),
})
