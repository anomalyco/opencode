import { Context } from "./context"
import { UserRole } from "./schema/user.sql"
import { Log } from "./util/log"

export namespace Actor {
  interface Account {
    type: "account"
    properties: {
      accountID: string
      email: string
    }
  }

  interface Public {
    type: "public"
    properties: {}
  }

  interface User {
    type: "user"
    properties: {
      userID: string
      workspaceID: string
      accountID: string
      role: (typeof UserRole)[number]
    }
  }

  interface System {
    type: "system"
    properties: {
      workspaceID: string
    }
  }

  export type Info = Account | Public | User | System

  const ctx = Context.create<Info>()
  export const use = ctx.use

  const log = Log.create().tag("namespace", "actor")

  export function provide<R, T extends Info["type"]>(
    type: T,
    properties: Extract<Info, { type: T }>["properties"],
    cb: () => R,
  ) {
    return ctx.provide(
      {
        type,
        properties,
      } as any,
      () => {
        return Log.provide({ ...properties }, () => {
          log.info("provided")
          return cb()
        })
      },
    )
  }

  export function assert<T extends Info["type"]>(type: T) {
    const actor = use()
    if (actor.type !== type) {
      throw new Error(`Expected actor type ${type}, got ${actor.type}`)
    }
    return actor as Extract<Info, { type: T }>
  }

  export const assertAdmin = () => {
    if (userRole() === "admin") return
    throw new Error(`Action not allowed. Ask your workspace admin to perform this action.`)
  }

  export function workspace() {
    const actor = use()
    if ("workspaceID" in actor.properties) {
      return actor.properties.workspaceID
    }
    throw new Error(`actor of type "${actor.type}" is not associated with a workspace`)
  }

  export function account() {
    const actor = use()
    if ("accountID" in actor.properties) {
      return actor.properties.accountID
    }
    throw new Error(`actor of type "${actor.type}" is not associated with an account`)
  }

  export function userID() {
    return Actor.assert("user").properties.userID
  }

  export function userRole() {
    return Actor.assert("user").properties.role
  }
}
