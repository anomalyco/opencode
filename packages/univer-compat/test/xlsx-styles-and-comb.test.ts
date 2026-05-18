import { auth, projHdr } from "./setup-compat-auth"
import { describe, expect, test } from "bun:test"
import ExcelJS from "exceljs"
import { createCompatApp } from "../src/app"
import { Store } from "../src/store"
import { MemoryExchangeFiles } from "../src/memory-exchange-files"
import { exchangePresignPut } from "./helpers/exchange-presign-upload"
import { xlsxToWorkbookJson } from "../src/xlsx-import"

async function sample() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("S1")
  const c = ws.getCell(1, 1)
  c.value = "styled"
  c.font = { bold: true, size: 14, color: { argb: "FF001122" } }
  c.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFAA00" },
  }
  ws.getCell(2, 1).value = "plain"
  const out = await wb.xlsx.writeBuffer()
  return new Uint8Array(out)
}

describe("xlsx styles → workbook JSON (binary in, structured styles out)", () => {
  test("ExcelJS xlsx carries bold, font color, fill into styles map and cell s", async () => {
    const buf = await sample()
    const uid = crypto.randomUUID()
    const wb = await xlsxToWorkbookJson(uid, buf)
    expect(wb.id).toBe(uid)
    expect(Object.keys(wb.styles).length).toBeGreaterThan(0)
    const sid = wb.sheetOrder[0]
    const sh = wb.sheets[sid] as { cellData?: Record<string, Record<string, { s?: string; v?: unknown }>> }
    const top = sh.cellData?.["0"]?.["0"]
    if (!top?.s) throw new Error("expected styled cell at r0 c0 with style id")
    const st = wb.styles[top.s]
    if (!st) throw new Error("missing style ref")
    expect(st.bl).toBe(1)
    expect(st.fs).toBe(14)
    expect((st.cl as { rgb?: string })?.rgb).toBe("#001122")
    expect((st.bg as { rgb?: string })?.rgb).toBe("#FFAA00")
    const plain = sh.cellData?.["1"]?.["0"]
    expect(plain?.s).toBeUndefined()
  })
})

describe("exchange import keeps styles in stored snapshot JSON", () => {
  test("upload + import task + GET rev exposes workbook.styles", async () => {
    const mem = new MemoryExchangeFiles()
    const store = new Store(mem, 1)
    const app = createCompatApp(store, auth)
    const buf = await sample()
    const fileId = await exchangePresignPut(app, buf)
    const ir = await app.request("http://127.0.0.1/universer-api/exchange/2/import", {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8", ...projHdr },
      body: JSON.stringify({
        fileID: fileId,
        outputType: 1,
        minSheetColumnCount: 1,
        minSheetRowCount: 1,
      }),
    })
    expect(ir.status).toBe(200)
    const imp = (await ir.json()) as { taskID: string }
    const tr = await app.request(`http://127.0.0.1/universer-api/exchange/task/${imp.taskID}`, {
      headers: { ...projHdr },
    })
    expect(tr.status).toBe(200)
    const task = (await tr.json()) as { status: string; import: { unitID: string } }
    expect(task.status).toBe("done")
    const unitID = task.import.unitID

    const rev = await app.request(`http://127.0.0.1/universer-api/snapshot/2/unit/${unitID}/rev/0`, {
      headers: { ...projHdr },
    })
    expect(rev.status).toBe(200)
    const body = (await rev.json()) as {
      snapshot: {
        workbook: {
          styles: Record<string, unknown>
          sheetOrder: string[]
          sheets: Record<string, unknown>
        }
      }
    }
    const styles = body.snapshot.workbook.styles
    expect(Object.keys(styles).length).toBeGreaterThan(0)
    const order = body.snapshot.workbook.sheetOrder as string[]
    const sheet = body.snapshot.workbook.sheets[order[0]] as {
      cellData?: Record<string, Record<string, { s?: string }>>
    }
    expect(sheet.cellData?.["0"]?.["0"]?.s).toBeDefined()
  })

  test("hydrate new Store from memory blob still has styles", async () => {
    const mem = new MemoryExchangeFiles()
    const s0 = new Store(mem, 1)
    const app0 = createCompatApp(s0, auth)
    const buf = await sample()
    const fid = await exchangePresignPut(app0, buf)
    const ir = await app0.request("http://127.0.0.1/universer-api/exchange/2/import", {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8", ...projHdr },
      body: JSON.stringify({ fileID: fid, outputType: 1, minSheetColumnCount: 1, minSheetRowCount: 1 }),
    })
    const tid = ((await ir.json()) as { taskID: string }).taskID
    await app0.request(`http://127.0.0.1/universer-api/exchange/task/${tid}`, { headers: { ...projHdr } })
    const t1 = (await (await app0.request(`http://127.0.0.1/universer-api/exchange/task/${tid}`, { headers: { ...projHdr } })).json()) as {
      import: { unitID: string }
    }
    const unitID = t1.import.unitID

    const s1 = new Store(mem, 1)
    const app1 = createCompatApp(s1, auth)
    const load = await app1.request(`http://127.0.0.1/universer-api/snapshot/2/unit/${unitID}/rev/0`, {
      headers: { ...projHdr },
    })
    expect(load.status).toBe(200)
    const j = (await load.json()) as { snapshot: { workbook: { styles: Record<string, unknown> } } }
    expect(Object.keys(j.snapshot.workbook.styles).length).toBeGreaterThan(0)
  })
})

function setRangeMut(unit: string, sheet: string, v: unknown, t: number) {
  return {
    id: "sheet.mutation.set-range-values",
    params: {
      unitId: unit,
      subUnitId: sheet,
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      cellValue: { "0": { "0": { v, t } } },
    },
  }
}

describe("comb new_changes and snapshot changeset", () => {
  test("POST comb new_changes applies set-range-values and GET rev shows cell", async () => {
    const app = createCompatApp(new Store(new MemoryExchangeFiles(), 1), auth)
    const cr = await app.request("http://127.0.0.1/universer-api/snapshot/2/unit/-/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...projHdr },
      body: JSON.stringify({ type: 2, name: "Sheet", creator: "t" }),
    })
    const { unitID } = (await cr.json()) as { unitID: string }
    const snap = await app.request(`http://127.0.0.1/universer-api/snapshot/2/unit/${unitID}/rev/0`, {
      headers: { ...projHdr },
    })
    const snapBody = (await snap.json()) as { snapshot: { workbook: { sheetOrder: string[] } } }
    const sheet = snapBody.snapshot.workbook.sheetOrder[0]

    const comb = await app.request(`http://127.0.0.1/universer-api/comb/2/unit/${unitID}/new_changes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...projHdr },
      body: JSON.stringify({
        unitID,
        memberID: "m1",
        type: 2,
        changeset: {
          baseRev: 0,
          unitID,
          memberID: "m1",
          mutations: [setRangeMut(unitID, sheet, 99, 2)],
        },
      }),
    })
    expect(comb.status).toBe(200)
    const ack = (await comb.json()) as { revision: number }
    expect(ack.revision).toBe(1)

    const rev = await app.request(`http://127.0.0.1/universer-api/snapshot/2/unit/${unitID}/rev/0`, {
      headers: { ...projHdr },
    })
    const body = (await rev.json()) as {
      snapshot: { workbook: { sheets: Record<string, { cellData?: Record<string, Record<string, { v?: unknown }>> }> } }
      latestRevision: number
      changesets: Array<{ mutations: { id: string }[] }>
    }
    expect(body.latestRevision).toBe(1)
    expect(body.snapshot.workbook.sheets[sheet].cellData?.["0"]?.["0"]?.v).toBe(99)
    expect(body.changesets.length).toBe(1)
    expect(body.changesets[0].mutations[0].id).toBe("sheet.mutation.set-range-values")
  })

  test("unknown mutation id returns 422", async () => {
    const app = createCompatApp(new Store(new MemoryExchangeFiles(), 1), auth)
    const cr = await app.request("http://127.0.0.1/universer-api/snapshot/2/unit/-/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...projHdr },
      body: JSON.stringify({ type: 2, name: "Sheet", creator: "t" }),
    })
    const { unitID } = (await cr.json()) as { unitID: string }
    const comb = await app.request(`http://127.0.0.1/universer-api/comb/2/unit/${unitID}/new_changes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...projHdr },
      body: JSON.stringify({
        unitID,
        memberID: "m1",
        type: 2,
        changeset: {
          baseRev: 0,
          unitID,
          memberID: "m1",
          mutations: [{ id: "mut-a", kind: "test" }],
        },
      }),
    })
    expect(comb.status).toBe(422)
  })

  test("POST snapshot changeset applies set-range-values", async () => {
    const app = createCompatApp(new Store(new MemoryExchangeFiles(), 1), auth)
    const cr = await app.request("http://127.0.0.1/universer-api/snapshot/2/unit/-/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...projHdr },
      body: JSON.stringify({ type: 2, name: "Sheet", creator: "t" }),
    })
    const { unitID } = (await cr.json()) as { unitID: string }
    const snap = await app.request(`http://127.0.0.1/universer-api/snapshot/2/unit/${unitID}/rev/0`, {
      headers: { ...projHdr },
    })
    const sheet = ((await snap.json()) as { snapshot: { workbook: { sheetOrder: string[] } } }).snapshot.workbook
      .sheetOrder[0]

    const cs = await app.request(`http://127.0.0.1/universer-api/snapshot/2/unit/${unitID}/changeset`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...projHdr },
      body: JSON.stringify({
        baseRev: 0,
        memberID: "m2",
        changeset: {
          baseRev: 0,
          unitID,
          mutations: [setRangeMut(unitID, sheet, "hi", 1)],
        },
      }),
    })
    expect(cs.status).toBe(200)

    const rev = await app.request(`http://127.0.0.1/universer-api/snapshot/2/unit/${unitID}/rev/0`, {
      headers: { ...projHdr },
    })
    const wb = (await rev.json()) as {
      snapshot: { workbook: { sheets: Record<string, { cellData?: Record<string, Record<string, { v?: unknown }>> }> } }
    }
    expect(wb.snapshot.workbook.sheets[sheet].cellData?.["0"]?.["0"]?.v).toBe("hi")
  })

  test("empty mutations still bump revision (no cell change)", async () => {
    const app = createCompatApp(new Store(new MemoryExchangeFiles(), 1), auth)
    const cr = await app.request("http://127.0.0.1/universer-api/snapshot/2/unit/-/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...projHdr },
      body: JSON.stringify({ type: 2, name: "Sheet", creator: "t" }),
    })
    const { unitID } = (await cr.json()) as { unitID: string }
    const comb = await app.request(`http://127.0.0.1/universer-api/comb/2/unit/${unitID}/new_changes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...projHdr },
      body: JSON.stringify({
        unitID,
        memberID: "m1",
        type: 2,
        changeset: { baseRev: 0, unitID, memberID: "m1", mutations: [] },
      }),
    })
    expect(comb.status).toBe(200)
    const j = (await comb.json()) as { revision: number }
    expect(j.revision).toBe(1)
  })
})
