import { Server } from "./server/server"

const result = await Server.listen({
  port: 1338,
  hostname: "0.0.0.0",
})

console.log(result)
