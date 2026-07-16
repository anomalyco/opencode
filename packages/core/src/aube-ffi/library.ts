// AUBE_FFI_LIBRARY points dlopen at a locally built libaube_ffi instead of the
// packaged platform library — the same override aube's own smoke tests use.
// Kept free of bun:ffi imports so non-Bun code paths can import it.
export const resolveLibraryPath = async () =>
  process.env["AUBE_FFI_LIBRARY"] ?? (await import("@jdxcode/aube-ffi")).libraryPath
