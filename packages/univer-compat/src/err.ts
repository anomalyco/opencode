export type ErrBody = { code: number; message: string }

export function okErr(): ErrBody {
  return { code: 1, message: "" }
}
