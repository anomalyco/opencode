import z from "zod"
import { Storage } from "@/storage/storage"

const preferenceSchema = z.object({
  skipSetup: z.boolean().optional(),
  updatedAt: z.number().optional(),
})

export type TwoFactorPreference = z.infer<typeof preferenceSchema>

const defaultPreference: TwoFactorPreference = {
  skipSetup: false,
}

function normalizePreference(input: unknown): TwoFactorPreference {
  const parsed = preferenceSchema.safeParse(input)
  if (!parsed.success) return { ...defaultPreference }
  return {
    skipSetup: parsed.data.skipSetup ?? false,
    updatedAt: parsed.data.updatedAt,
  }
}

export async function getTwoFactorPreference(username: string): Promise<TwoFactorPreference> {
  try {
    const stored = await Storage.read<TwoFactorPreference>(["auth", "2fa", "preference", username])
    return normalizePreference(stored)
  } catch (err) {
    if (err instanceof Storage.NotFoundError) return { ...defaultPreference }
    throw err
  }
}

export async function setTwoFactorPreference(username: string, next: TwoFactorPreference): Promise<void> {
  const normalized = normalizePreference(next)
  await Storage.write(["auth", "2fa", "preference", username], {
    ...normalized,
    updatedAt: Date.now(),
  })
}
