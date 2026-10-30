// Loaded from a file rather than inline so the page's Content-Security-Policy can stay free of 'unsafe-inline'.
const labels = {
  operational: "All systems operational",
  degraded: "Degraded performance",
  outage: "Service disruption",
}

const link = document.querySelector(".legal a[data-status]")
if (link) {
  fetch("/status/api/summary", { signal: AbortSignal.timeout(10_000) })
    .then((response) => (response.ok ? response.json() : undefined))
    .then((body) => {
      const status = body && typeof body === "object" ? body.status : undefined
      if (!Object.hasOwn(labels, status)) return
      link.dataset.status = status
      link.textContent = labels[status]
    })
    .catch(() => {})
}
