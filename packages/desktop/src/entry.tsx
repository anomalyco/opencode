const fail = (error: unknown) => {
  console.error(error)
  const root = document.getElementById("root")
  if (!root) return
  const text = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)
  root.innerHTML = `<pre style="padding:16px;font-size:12px;white-space:pre-wrap;font-family:monospace">Failed to load desktop app\n\n${text}</pre>`
}

void (location.pathname === "/loading" ? import("./loading.tsx") : import("./index.tsx")).catch(fail)
