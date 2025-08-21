import { createAsync, query } from "@solidjs/router"
import { getActor, withActor } from "~/context/auth"

const getPosts = query(async () => {
  "use server"
  return withActor(() => {
    return "ok"
  })
}, "posts")


export default function () {
  const actor = createAsync(async () => getActor())
  return <div>{JSON.stringify(actor())}</div>
}
