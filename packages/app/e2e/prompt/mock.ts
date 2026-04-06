type Hit = { body: Record<string, unknown> }

export function bodyText(hit: Hit) {
  return JSON.stringify(hit.body)
}

/**
 * Match requests whose body contains the exact serialized tool input.
 * The seed prompts embed JSON.stringify(input) in the prompt text, which
 * gets escaped again inside the JSON body — so we double-escape to match.
 */
export function inputMatch(input: unknown) {
  const escaped = JSON.stringify(JSON.stringify(input)).slice(1, -1)
  return (hit: Hit) => bodyText(hit).includes(escaped)
}
