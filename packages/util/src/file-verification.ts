/** The host cannot verify file handles. This is not a missing file or a permission decision. */
export class FileVerificationError extends Error {
  static readonly code = "file_verification_unavailable"
  static readonly description = "File previews and transfers are unavailable in this build because file verification could not be loaded."
  readonly _tag = FileVerificationError.code

  constructor() {
    super(FileVerificationError.description)
  }

  static orMissing(error: unknown) {
    if (error instanceof FileVerificationError) throw error
    return undefined
  }

  static readonly header = "x-opencode-file-error"

  static async check(response: Response) {
    if (response.status === 503 && response.headers.get(this.header) === this.code) {
      await response.body?.cancel()
      throw new FileVerificationError()
    }
    return response
  }
}

let reported = false

/** Log at the origin only; a page may request hundreds of resources from the same unavailable verifier. */
export function verificationUnavailable(cause?: unknown): never {
  if (!reported) {
    reported = true
    console.warn(FileVerificationError.code, cause instanceof Error ? cause.message : FileVerificationError.description)
  }
  throw new FileVerificationError()
}
