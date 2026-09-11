// build.ts replaces this with `import { type: "file" }` paths during the compile step,
// then restores the stub so `bun typecheck` and `bun dev` work without generated files.
export default {} as Record<string, { wasm: string; queries: Record<string, string[]> }>
