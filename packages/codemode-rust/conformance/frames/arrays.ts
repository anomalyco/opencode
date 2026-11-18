// Arrays and Uint8Array: cases for conformance/streaming.ts (see its `searching`, `after` and `during`).
type Helpers = {
  after: (setup: string, work: string) => string
  during: (setup: string, loop: string) => string
  text: unknown
}

export default (_: Helpers) => ({
  searches: [] as Array<string>,
  programs: [] as Array<string>,
  suspensions: [] as Array<string>,
})
