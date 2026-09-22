import { redirect } from "@solidjs/router"

export default function () {
  throw redirect("/console/go")
}
