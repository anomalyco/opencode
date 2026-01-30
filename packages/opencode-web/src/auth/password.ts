// Use Bun's built-in password hashing (bcrypt under the hood, but cross-platform)

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: "bcrypt",
    cost: 12,
  })
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash)
}

export function hashToken(token: string): string {
  // For refresh tokens, use a faster hash since we're storing them
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(token)
  return hasher.digest("hex")
}
