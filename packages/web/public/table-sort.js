// Table sorting functionality for documentation pages
; (function () {
  function initTableSorting() {
    const tables = document.querySelectorAll("table")

    tables.forEach((table) => {
      const headers = table.querySelectorAll("thead th")
      if (!headers.length) return

      headers.forEach((header, index) => {
        header.style.cursor = "pointer"
        header.style.userSelect = "none"
        header.setAttribute("role", "button")
        header.setAttribute("tabindex", "0")
        header.setAttribute("aria-label", `Sort by ${header.textContent?.trim() || "column"}`)

        header.addEventListener("click", () => sortTable(table, index, header))
        header.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            sortTable(table, index, header)
          }
        })
      })
    })
  }

  function sortTable(table, columnIndex, header) {
    const tbody = table.querySelector("tbody")
    if (!tbody) {
      return
    }

    const rows = Array.from(tbody.querySelectorAll("tr"))

    // Check if column contains prices (values with $ or numeric values)
    const numericCount = rows.filter((row) => {
      const cell = row.cells[columnIndex]
      if (!cell) {
        return false
      }

      const text = cell?.textContent?.trim() || ""
      const num = parseFloat(text.replace(/[$,]/g, ""))
      return !isNaN(num) && text !== ""
    }).length

    // If > 50% are numeric, treat as numeric column
    const isNumeric = numericCount / rows.length > 0.5

    const currentSort = header.getAttribute("data-sort")
    const direction = currentSort === "asc" ? "desc" : "asc"

    table.querySelectorAll("th").forEach((th) => {
      th.removeAttribute("data-sort")
      th.textContent = th.textContent?.replace(/ [↑↓]$/, "") || ""
    })

    header.setAttribute("data-sort", direction)
    const arrow = direction === "asc" ? " ↑" : " ↓"
    header.textContent = (header.textContent?.replace(/ [↑↓]$/, "") || "") + arrow

    rows.sort((a, b) => {
      const aCell = a.cells[columnIndex]
      const bCell = b.cells[columnIndex]
      const aText = aCell?.textContent?.trim() || ""
      const bText = bCell?.textContent?.trim() || ""

      if (isNumeric) {
        // Parse numeric values
        const aClean = aText.replace(/[$,]/g, "")
        const bClean = bText.replace(/[$,]/g, "")
        const aParsed = parseFloat(aClean)
        const bParsed = parseFloat(bClean)

        // Classify: dash = -2, Free/text = -1, numbers = actual value
        const getValue = (text, parsed) => {
          if (text === "-") return -2
          if (isNaN(parsed)) return -1
          return parsed
        }

        const aNum = getValue(aClean, aParsed)
        const bNum = getValue(bClean, bParsed)
        return direction === "asc" ? aNum - bNum : bNum - aNum
      } else {
        return direction === "asc" ? aText.localeCompare(bText) : bText.localeCompare(aText)
      }
    })

    rows.forEach((row) => tbody.appendChild(row))
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTableSorting)
  } else {
    initTableSorting()
  }
})()
