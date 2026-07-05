import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { Newtype } from "../src/schema"

class UserID extends Newtype<UserID>()("Test.UserID", Schema.NonEmptyString) {}
class ProjectID extends Newtype<ProjectID>()("Test.ProjectID", Schema.NonEmptyString) {}
class Port extends Newtype<Port>()("Test.Port", Schema.FiniteFromString) {}

const User = Schema.Struct({ id: UserID })

test("constructs nominal values from the underlying type", () => {
  const id = UserID.make("user-1")
  const acceptUserID = (_id: UserID) => undefined

  expect(String(id)).toBe("user-1")
  acceptUserID(id)

  if (false) {
    // @ts-expect-error distinct newtypes are not interchangeable
    acceptUserID(ProjectID.make("project-1"))
  }
})

test("preserves constructor validation", () => {
  expect(() => UserID.make("")).toThrow()
})

test("decodes and encodes as a schema", async () => {
  const decoded = await Effect.runPromise(Schema.decodeUnknownEffect(User)({ id: "user-1" }))
  const encoded = await Effect.runPromise(Schema.encodeEffect(User)(decoded))

  expect(String(decoded.id)).toBe("user-1")
  expect(encoded).toEqual({ id: "user-1" })
})

test("preserves the underlying schema validation", async () => {
  const result = await Effect.runPromise(Schema.decodeUnknownEffect(UserID)("").pipe(Effect.result))
  expect(result._tag).toBe("Failure")
})

test("preserves transformed encoded and decoded representations", async () => {
  const decoded = await Effect.runPromise(Schema.decodeUnknownEffect(Port)("8080"))
  const encoded = await Effect.runPromise(Schema.encodeEffect(Port)(decoded))

  expect(Number(decoded)).toBe(8080)
  expect(encoded).toBe("8080")
})
