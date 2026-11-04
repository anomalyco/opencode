// P-ORACLE for crates/ui/src/path.rs: the TUI's formatPath and abbreviateHome (packages/tui/src/util/path-format.ts)
// over POSIX and Windows paths. Writes parity/fixtures/U.3/path.json; crates/ui/tests/dialogs.rs expects the same
// strings.
import { abbreviateHome, formatPath } from "../../../tui/src/util/path-format"

const posix = {
  base: ["/home/ada/src/app", "/", "/home/ada", "/tmp/x/"],
  home: ["/home/ada", "", "/home/ada/"],
  input: [
    "",
    "/home/ada/src/app",
    "/home/ada/src/app/lib/main.rs",
    "lib/main.rs",
    "./lib/../lib/./main.rs",
    "../other/file",
    "/home/ada/notes.md",
    "/home/ada",
    "/home/adam/file",
    "/etc/hosts",
    "/",
    "//double//slash/",
    "..",
    "~/literal",
    "C:\\Users\\ada\\file.txt",
    "\\\\server\\share\\file",
  ],
}
const windows = {
  base: ["C:\\Users\\ada\\src\\app", "c:/Users/ada", "\\\\server\\share\\dir"],
  home: ["C:\\Users\\ada", ""],
  input: [
    "C:\\Users\\ada\\src\\app\\lib\\main.rs",
    "c:\\users\\ada\\src\\app\\x",
    "lib\\main.rs",
    "lib/main.rs",
    "..\\other",
    "C:\\Users\\ada\\notes.md",
    "D:\\data\\file",
    "C:\\",
    "\\\\server\\share\\dir\\file",
    "/home/ada/file",
  ],
}

const cases = [posix, windows].flatMap((set) =>
  set.base.flatMap((base) =>
    set.home.flatMap((home) =>
      set.input.flatMap((input) =>
        [false, true].map((forwardSlashes) => ({
          input,
          base,
          home,
          forwardSlashes,
          format: formatPath(input, { base, home: home || undefined, forwardSlashes }),
          abbreviate: abbreviateHome(input, home),
        })),
      ),
    ),
  ),
)

const path = new URL("../fixtures/U.3/path.json", import.meta.url).pathname
await Bun.write(path, JSON.stringify(cases, null, 1) + "\n")
console.log(`oracle: U.3/path ${cases.length} cases`)
