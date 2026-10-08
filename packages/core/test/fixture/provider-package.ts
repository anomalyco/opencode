import { Effect } from "effect"
import { Provider } from "@opencode/core/provider"

const loaded = await Effect.runPromise(Provider.loadPackage(process.argv[2] ?? ""))
const model = loaded.model("test-model", { baseURL: "https://gateway.example.com/v1" })
console.log(model.id)
