/** The host cannot verify file handles. This is not a missing file or a permission decision. */
export class FileVerificationError extends Error {
  static readonly code = "file_verification_unavailable"
  static readonly description = "File previews and transfers are unavailable in this build because file verification could not be loaded."
  readonly _tag = FileVerificationError.code

  constructor() {
    super(FileVerificationError.description)
  }

  // SAFETY: a rejection's reason is unknown by contract; this is the boundary that classifies it, by `instanceof` only.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
  static orMissing(error: unknown) {
    if (error instanceof FileVerificationError) throw error

    return undefined
  }
}
