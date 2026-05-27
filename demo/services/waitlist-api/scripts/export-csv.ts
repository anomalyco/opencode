// Firestore の waitlist コレクションを CSV として標準出力に書き出す（ローカル実行）。
//
// 認証: GOOGLE_ACCESS_TOKEN（`gcloud auth print-access-token`）を使う。
// 使い方:
//   GCP_PROJECT=xxx GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token) \
//     bun run scripts/export-csv.ts > waitlist.csv
//
// ※ 出力 CSV は個人情報（email）を含む。社内のみで扱い、外部共有しないこと。

const GCP_PROJECT = process.env.GCP_PROJECT
const COLLECTION = process.env.FIRESTORE_COLLECTION ?? "waitlist"
const DATABASE = process.env.FIRESTORE_DATABASE ?? "(default)"
const TOKEN = process.env.GOOGLE_ACCESS_TOKEN

if (!GCP_PROJECT) {
  console.error("GCP_PROJECT is required")
  process.exit(1)
}
if (!TOKEN) {
  console.error(
    "GOOGLE_ACCESS_TOKEN is required（例: export GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token)）",
  )
  process.exit(1)
}

const BASE =
  `https://firestore.googleapis.com/v1/projects/${GCP_PROJECT}` +
  `/databases/${encodeURIComponent(DATABASE)}/documents`

type FsValue = { stringValue?: string; timestampValue?: string }
type FsDoc = { name: string; fields?: Record<string, FsValue> }

function csvCell(v: string): string {
  return `"${v.replace(/"/g, '""')}"`
}

async function main() {
  const rows: string[] = ["email,registeredAt,status,source"]
  let pageToken: string | undefined

  do {
    const url = new URL(`${BASE}/${COLLECTION}`)
    url.searchParams.set("pageSize", "300")
    if (pageToken) url.searchParams.set("pageToken", pageToken)

    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })
    if (!res.ok) {
      console.error(`list failed: ${res.status} ${await res.text().catch(() => "")}`)
      process.exit(1)
    }
    const json = (await res.json()) as { documents?: FsDoc[]; nextPageToken?: string }
    for (const d of json.documents ?? []) {
      const f = d.fields ?? {}
      rows.push(
        [
          f.email?.stringValue ?? "",
          f.registeredAt?.timestampValue ?? "",
          f.status?.stringValue ?? "",
          f.source?.stringValue ?? "",
        ]
          .map(csvCell)
          .join(","),
      )
    }
    pageToken = json.nextPageToken
  } while (pageToken)

  console.log(rows.join("\n"))
}

main()
