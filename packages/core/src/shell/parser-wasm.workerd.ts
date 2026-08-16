// workerd has no filesystem paths to tree-sitter wasm artifacts. ShellParse
// loads these lazily and degrades when initialization fails, so empty paths
// keep module load side-effect free instead of resolving from disk.
export const shellParserWasm = { runtime: "", bash: "", powershell: "" }
