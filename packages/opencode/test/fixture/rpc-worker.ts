import { Rpc } from "../../src/util/rpc"

export const rpc = {
  echo(input: string) {
    return input
  },
  throws() {
    throw new Error("thrown in the worker")
  },
  async rejects() {
    throw new Error("rejected in the worker")
  },
  wrapped() {
    throw new Error("", { cause: new Error("the cause says why") })
  },
}

Rpc.listen(rpc)
