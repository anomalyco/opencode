import { expect, test } from "bun:test"
import { S3Client } from "bun"
import { S3Client as AwsJsS3Client } from "@aws-sdk/client-s3"
import { GenericContainer, Network, Wait, type StartedTestContainer } from "testcontainers"
import * as XLSX from "xlsx"
import { headerSessionResolver } from "@veritly/auth-shared"
import { createCompatApp } from "../src/app"
import { assertSafeUserSegment } from "../src/object-keys"
import { S3ExchangeFiles } from "../src/exchange-files"
import { runWithRequestUserAsync } from "../src/request-user"
import { Store } from "../src/store"

const tenantHdr = "x-e2e-univer-tenant"
const testTenantResolver = headerSessionResolver(tenantHdr, assertSafeUserSegment)

function hdr(user: string) {
  return { [tenantHdr]: user }
}

const access = "veritlyminio"
const secret = "veritlyminio_dev"
const region = "us-east-1"
const bucket = "veritly-presign-it"
const minioServerImage = "minio/minio:RELEASE.2025-09-07T16-13-09Z"

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function tinyXlsx() {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([["s3"]])
  XLSX.utils.book_append_sheet(wb, ws, "S1")
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }))
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

test.skipIf(process.env.UNIVER_COMPAT_PRESIGN_S3_IT !== "1")(
  "cross-tenant import rejected after real presigned PUT to MinIO",
  async () => {
    const net = await new Network().start()
    let minio: StartedTestContainer | undefined
    let init: StartedTestContainer | undefined
    try {
      minio = await new GenericContainer(minioServerImage)
        .withExposedPorts(9000)
        .withEnvironment({
          MINIO_ROOT_USER: access,
          MINIO_ROOT_PASSWORD: secret,
        })
        .withNetwork(net)
        .withNetworkAliases("minio")
        .withCommand(["server", "/data", "--address", ":9000", "--console-address", ":9001"])
        .withWaitStrategy(Wait.forLogMessage(/MinIO Object Storage Server/))
        .withStartupTimeout(180_000)
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

      const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`
      const client = await minioReady(endpoint)
      const signer = new AwsJsS3Client({
        region,
        endpoint,
        credentials: { accessKeyId: access, secretAccessKey: secret },
        forcePathStyle: true,
      })
      const blob = new S3ExchangeFiles(client, signer, bucket)
      const app = createCompatApp(new Store(blob, 1), testTenantResolver)

      const buf = tinyXlsx()
      const ct = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

      const pr = await app.request("http://127.0.0.1/universer-api/stream/file/presign-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...hdr("s3-tenant-alpha") },
        body: JSON.stringify({ size: buf.byteLength, contentType: ct }),
      })
      expect(pr.status).toBe(200)
      const j = (await pr.json()) as { FileId: string; uploadUrl: string; headers: Record<string, string> }
      const put = await fetch(j.uploadUrl, { method: "PUT", headers: j.headers, body: Buffer.from(buf) })
      expect(put.ok).toBe(true)

      const ir = await app.request("http://127.0.0.1/universer-api/exchange/2/import", {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=UTF-8", ...hdr("s3-tenant-bravo") },
        body: JSON.stringify({
          fileID: j.FileId,
          outputType: 1,
          minSheetColumnCount: 1,
          minSheetRowCount: 1,
        }),
      })
      expect(ir.status).toBe(404)

      await runWithRequestUserAsync("s3-tenant-alpha", async () => {
        const ok = await blob.exists(`u/s3-tenant-alpha/sheets/exchange/${j.FileId}`)
        expect(ok).toBe(true)
      })
    } finally {
      if (init) await init.stop()
      if (minio) await minio.stop()
      await net.stop()
    }
  },
  180_000,
)
