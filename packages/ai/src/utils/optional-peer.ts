/** True when a dynamic import failed because the optional peer dependency `name` is not installed. */
export const isMissingPackage = (error: unknown, name: string) =>
  error instanceof Error &&
  "code" in error &&
  error.code === "ERR_MODULE_NOT_FOUND" &&
  error.message.includes(`'${name}'`)
