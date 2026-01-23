import { Global } from "../global"

export async function data() {
  const path = Bun.env.MODELS_DEV_API_JSON
  if (path) {
    const file = Bun.file(path)
    if (await file.exists()) {
      return await file.text()
    }
  }
  const url = Global.Path.modelsDevUrl
  const json = await fetch(`${url}/api.json`).then((x) => x.text())
  return json
}
