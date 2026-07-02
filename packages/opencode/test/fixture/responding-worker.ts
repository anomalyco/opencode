// Worker fixture: responds to one RPC call then throws
import { Rpc } from "../../src/util/rpc"

const rpc = {
  async ping() {
    return "pong"
  },
}

Rpc.listen(rpc)
