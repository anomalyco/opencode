import { TuiThreadCommand } from "./cli/cmd/tui/thread"
import { Log } from "./node"

Log.init({
  print: false,
})

console.log(TuiThreadCommand)

console.log(performance.now())
