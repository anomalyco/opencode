
import { logJson } from "./src/server/lib/logging.ts";

console.log("Testing logging...");
logJson("info", { kind: "test", message: "Hello from test script" });
console.log("Done.");
