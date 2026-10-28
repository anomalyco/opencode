import { expect, test } from "bun:test"
import { compile } from "@opencode/httpapi-codegen"
import {
  ClientApi,
  clientNamespace,
  effectOmitEndpoints,
  groupNames,
  promiseOmitEndpoints,
} from "@opencode/protocol/client"
import { Effect } from "effect"
import { HttpClient } from "effect/http"
import { OpenCode as EffectOpenCode } from "../src/effect/index"
import { OpenCode as PromiseOpenCode } from "../src/promise/index"

// The pre-experimental paths stay until the next minor.
const aliases = (omitEndpoints: ReadonlySet<string>) =>
  compile(ClientApi, { groupNames, omitEndpoints, namespace: clientNamespace, aliases: true }).aliases ?? []

const at = (root: unknown, path: ReadonlyArray<string>) =>
  path.reduce<unknown>((parent, key) => (parent as Record<string, unknown> | undefined)?.[key], root)

const expectSameFunctions = (client: unknown, list: ReturnType<typeof aliases>) => {
  expect(list.length).toBeGreaterThan(20)
  for (const alias of list) {
    expect(alias.to[0]).toBe("experimental")
    const target = at(client, alias.to)
    expect(target).toBeFunction()
    expect(at(client, alias.from)).toBe(target)
  }
}

test("every Promise client alias is the same function as its client.experimental path", () => {
  expectSameFunctions(PromiseOpenCode.make({ baseUrl: "http://localhost:3000" }), aliases(promiseOmitEndpoints))
})

test("every Effect client alias is the same function as its client.experimental path", async () => {
  const client = await EffectOpenCode.make({ baseUrl: "http://localhost:3000" }).pipe(
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die("unused")),
    ),
    Effect.runPromise,
  )
  expectSameFunctions(client, aliases(effectOmitEndpoints))
})
