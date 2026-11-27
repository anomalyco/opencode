// Modules the OG Worker imports that script/build-og-worker.ts writes next to its bundle: compiled Wasm and binary
// font data.
declare module "*.wasm" {
  const module: WebAssembly.Module
  export default module
}

declare module "*.bin" {
  const data: ArrayBuffer
  export default data
}
