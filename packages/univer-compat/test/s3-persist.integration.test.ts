import { afterAll, describe, expect, test } from "bun:test"
import { S3Client } from "bun"
import { GenericContainer, Network, Wait, type StartedNetwork, type StartedTestContainer } from "testcontainers"
import { createCompatApp } from "../src/app"
import { S3ExchangeFiles } from "../src/exchange-files"
import { Store, unitStateKey } from "../src/store"

const access = "veritlyminio"
const secret = "veritlyminio_dev"
const region = "us-east-1"
const bucket = "veritly-compat-it"

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function minioReady(endpoint: string) {
  const client = new S3Client({
    accessKeyId: access,
    secretAccessKey: secret,
    bucket,
    endpoint,
    region,
  })
  const end = Date.now() + 60_000
  while (Date.now() < end) {
    try {
      await client.list({ maxKeys: 1 })
      return client
    } catch {
      await sleep(300)
    }
  }
  throw new Error("minio not ready")
}

describe.skipIf(process.env.UNIVER_COMPAT_S3_IT !== "1")("S3 persist + hydrate (MinIO Testcontainers)", () => {
  let net: StartedNetwork | undefined
  let minio: StartedTestContainer | undefined
  let init: StartedTestContainer | undefined
  let endpoint: string
  let client: S3Client

  afterAll(async () => {
    if (init) await init.stop()
    if (minio) await minio.stop()
    if (net) await net.stop()
  })

  test("persistEveryRev=3: stale hydrate until boundary write", async () => {
    net = await new Network().start()
    minio = await new GenericContainer("minio/minio:latest")
      .withExposedPorts(9000)
      .withEnvironment({
        MINIO_ROOT_USER: access,
        MINIO_ROOT_PASSWORD: secret,
      })
      .withNetwork(net)
      .withNetworkAliases("minio")
      .withCommand(["server", "/data", "--address", ":9000", "--console-address", ":9001"])
      .withWaitStrategy(Wait.forLogMessage("API:"))
      .withStartupTimeout(60_000)
      .start()

    init = await new GenericContainer("minio/mc:latest")
      .withNetwork(net)
      .withEntrypoint(["sh", "-c"])
      .withCommand([
        `for i in $(seq 1 60); do mc alias set local http://minio:9000 ${access} ${secret} && break; sleep 1; done; mc mb local/${bucket} --ignore-existing`,
      ])
      .withWaitStrategy(Wait.forOneShotStartup())
      .withStartupTimeout(60_000)
      .start()

    endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`
    client = await minioReady(endpoint)
    const blob = new S3ExchangeFiles(client)
    const s1 = new Store(blob, 3)
    const app1 = createCompatApp(s1)

    const cr = await app1.request("http://127.0.0.1/universer-api/snapshot/2/unit/-/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: 2, name: "S", creator: "it" }),
    })
    const { unitID } = (await cr.json()) as { unitID: string }
    const snap = await app1.request(`http://127.0.0.1/universer-api/snapshot/2/unit/${unitID}/rev/0`)
    const sheet = ((await snap.json()) as { snapshot: { workbook: { sheetOrder: string[] } } }).snapshot.workbook
      .sheetOrder[0]

    const mut = (v: unknown, t: number, base: number) =>
      app1.request(`http://127.0.0.1/universer-api/comb/2/unit/${unitID}/new_changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitID,
          memberID: "it",
          type: 2,
          changeset: {
            baseRev: base,
            unitID,
            memberID: "it",
            mutations: [
              {
                id: "sheet.mutation.set-range-values",
                params: {
                  unitId: unitID,
                  subUnitId: sheet,
                  range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
                  cellValue: { "0": { "0": { v, t } } },
                },
              },
            ],
          },
        }),
      })

    expect((await mut(10, 2, 0)).status).toBe(200)
    expect((await mut(20, 2, 1)).status).toBe(200)

    const s2 = new Store(blob, 3)
    const app2 = createCompatApp(s2)
    await s2.hydrateUnit(unitID)
    const stale = await app2.request(`http://127.0.0.1/universer-api/snapshot/2/unit/${unitID}/rev/0`)
    const staleBody = (await stale.json()) as {
      snapshot: { workbook: { sheets: Record<string, { cellData?: Record<string, Record<string, { v?: unknown }>> }> } }
    }
    expect(staleBody.snapshot.workbook.sheets[sheet].cellData?.["0"]?.["0"]?.v).toBe(10)

    expect((await mut(30, 2, 2)).status).toBe(200)

    const raw = new TextDecoder().decode(await client.file(unitStateKey(unitID)).bytes())
    const bundle = JSON.parse(raw) as {
      unit: { revision: number }
      snapshots: Array<{ revision: number; snapshot: string }>
    }
    expect(bundle.unit.revision).toBe(3)
    const last = JSON.parse(bundle.snapshots[bundle.snapshots.length - 1].snapshot) as {
      sheets: Record<string, { cellData?: Record<string, Record<string, { v?: unknown }>> }>
    }
    expect(last.sheets[sheet].cellData?.["0"]?.["0"]?.v).toBe(30)
  }, 180_000)
})
