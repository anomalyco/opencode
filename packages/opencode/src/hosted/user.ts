import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import { Flag } from "@/flag/flag"
import z from "zod"

export namespace HostedUser {
  export const Role = z.enum(["admin", "member"])

  export const Info = z
    .object({
      id: Identifier.schema("user"),
      email: z.string().email(),
      role: Role,
      disabled: z.boolean(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        last_login: z.number().optional(),
      }),
    })
    .meta({
      ref: "HostedUser",
    })
  export type Info = z.output<typeof Info>

  const Stored = Info.extend({
    password_hash: z.string(),
  })
  type Stored = z.output<typeof Stored>

  const Bootstrap = z.object({
    email: z.string().email(),
    password: z.string().min(8),
  })

  function clean(email: string) {
    return email.trim().toLowerCase()
  }

  function publicUser(user: Stored): Info {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      disabled: user.disabled,
      time: user.time,
    }
  }

  async function all() {
    const keys = await Storage.list(["hosted_user"])
    const users = await Promise.all(keys.map((key) => Storage.read<Stored>(key).catch(() => undefined)))
    return users.filter((user): user is Stored => !!user).sort((a, b) => a.email.localeCompare(b.email))
  }

  export async function bootstrap() {
    const users = await all()
    if (users.length > 0) return

    const input = Bootstrap.safeParse({
      email: Flag.OPENCODE_BOOTSTRAP_ADMIN_EMAIL,
      password: Flag.OPENCODE_BOOTSTRAP_ADMIN_PASSWORD,
    })
    if (!input.success) return

    await create({
      email: input.data.email,
      password: input.data.password,
      role: "admin",
    })
  }

  export async function enabled() {
    if (Flag.OPENCODE_BOOTSTRAP_ADMIN_EMAIL && Flag.OPENCODE_BOOTSTRAP_ADMIN_PASSWORD) return true
    return (await all()).length > 0
  }

  export async function list() {
    await bootstrap()
    return all().then((users) => users.map(publicUser))
  }

  export async function get(userID: string) {
    await bootstrap()
    return Storage.read<Stored>(["hosted_user", userID]).catch(() => undefined)
  }

  export async function byEmail(email: string) {
    await bootstrap()
    const value = clean(email)
    const users = await all()
    return users.find((user) => user.email === value)
  }

  export async function create(input: { email: string; password: string; role: z.infer<typeof Role> }) {
    const email = clean(input.email)
    const existing = await byEmail(email)
    if (existing) throw new Error("User already exists")

    const now = Date.now()
    const id = Identifier.ascending("user")
    const user: Stored = {
      id,
      email,
      role: input.role,
      disabled: false,
      password_hash: await Bun.password.hash(input.password),
      time: {
        created: now,
        updated: now,
      },
    }
    await Storage.write(["hosted_user", id], user)
    return publicUser(user)
  }

  export async function update(input: { userID: string; role?: z.infer<typeof Role>; disabled?: boolean }) {
    const user = await Storage.update<Stored>(["hosted_user", input.userID], (draft) => {
      if (input.role !== undefined) draft.role = input.role
      if (input.disabled !== undefined) draft.disabled = input.disabled
      draft.time.updated = Date.now()
    })
    return publicUser(user)
  }

  export async function login(input: { email: string; password: string }) {
    const user = await byEmail(input.email)
    if (!user || user.disabled) return
    const ok = await Bun.password.verify(input.password, user.password_hash)
    if (!ok) return
    return publicUser(user)
  }

  export async function touch(userID: string) {
    const user = await get(userID)
    if (!user) return
    await Storage.update<Stored>(["hosted_user", userID], (draft) => {
      draft.time.updated = Date.now()
      draft.time.last_login = Date.now()
    })
  }
}
