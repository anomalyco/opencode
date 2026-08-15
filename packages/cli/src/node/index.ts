import "./plugin-runtime.promise"
import "./plugin-runtime.effect"
import { guardStdio } from "../stdio"

guardStdio()

await import("../index")
