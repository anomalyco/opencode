/**
 * A live web `Response` a host function hands the program, whose body the host streams for the lifetime of the run.
 * The program sees a `Response`: `url`, `status`, `statusText`, `ok`, `redirected`, `headers`, a live `bodyUsed`,
 * `text()`, `json()`, `bytes()`, `arrayBuffer()`, and a `body` it can read with a reader or `for await`.
 */
export class StreamingResponse {
  constructor(
    readonly response: Response,
    readonly redirected = response.redirected,
  ) {}
}
