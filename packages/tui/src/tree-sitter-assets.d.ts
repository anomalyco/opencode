// local-only: Typen für die lokal mitgelieferten Tree-sitter-Dateien (`with { type: "file" }` liefert einen Pfad).
declare module "*.wasm" {
  const path: string
  export default path
}

declare module "*.scm" {
  const path: string
  export default path
}
