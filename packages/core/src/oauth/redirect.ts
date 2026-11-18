import { Deferred, Effect } from "effect"

/**
 * Builds an automatic sign-in's `submit`: reads the redirect URL the user pasted with `pasted`, then settles the
 * sign-in's pending `callback` as the browser's redirect would. `received` turns the redirect into that value.
 */
export const submit =
  <A>(input: {
    state: string
    callback: Deferred.Deferred<A, Error>
    received: (code: string, params: URLSearchParams) => A
  }) =>
  (text: string) =>
    pasted(text, input.state).pipe(
      Effect.flatMap((result) =>
        "error" in result
          ? Deferred.fail(input.callback, new Error(result.error))
          : Deferred.succeed(input.callback, input.received(result.code, result.params)),
      ),
      Effect.asVoid,
    )

/**
 * Reads the redirect URL a user pasted when the browser could not reach this machine's callback server
 * (SSH, a remote desktop, a container). It must carry the sign-in's `state`, the same check the browser's
 * redirect passes. A failure here rejects only this paste, so the sign-in keeps waiting; an `error` the
 * provider put in a valid redirect is returned, and ends the sign-in as it would in the browser.
 */
export const pasted = (text: string, state: string) =>
  Effect.gen(function* () {
    const value = text.trim()
    if (!URL.canParse(value)) return yield* Effect.fail(new Error("Paste the full URL from the browser's address bar"))
    const params = new URL(value).searchParams
    if (params.get("state") !== state) return yield* Effect.fail(new Error("This URL belongs to a different sign-in"))
    const error = params.get("error_description") ?? params.get("error")
    if (error) return { params, error }
    const code = params.get("code")
    if (!code) return yield* Effect.fail(new Error("The URL does not contain an authorization code"))
    return { params, code }
  })

export * as OauthRedirect from "./redirect.js"
