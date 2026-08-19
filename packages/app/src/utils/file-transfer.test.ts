import { describe, expect, mock, test } from "bun:test"
import { downloadFile, MaxUploadBytes, uploadFile, UploadTooLargeError } from "@/utils/file-transfer"

type ProgressEventLike = { lengthComputable: boolean; loaded: number; total: number }

class XHRMock {
  static instances: XHRMock[] = []
  upload: { onprogress: ((event: ProgressEventLike) => void) | null }
  method = ""
  url = ""
  status = 0
  statusText = ""
  responseText = ""
  body: unknown
  headers: Record<string, string> = {}
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onabort: (() => void) | null = null
  sent = false
  timeout = 0

  constructor() {
    this.upload = { onprogress: null }
    XHRMock.instances.push(this)
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value
  }
  send(body: unknown) {
    this.body = body
    this.sent = true
  }
}

function installXHRMock() {
  XHRMock.instances = []
  globalThis.XMLHttpRequest = XHRMock as unknown as typeof XMLHttpRequest
}

describe("uploadFile", () => {
  test("rejects files over the size limit without sending a request", async () => {
    installXHRMock()
    const big = {
      name: "big.bin",
      size: MaxUploadBytes + 1,
      arrayBuffer: () => Promise.reject(new Error("arrayBuffer should not be called")),
    } as unknown as File
    await expect(
      uploadFile({ url: "http://localhost/", directory: "/proj", headers: {}, path: "big.bin", file: big }),
    ).rejects.toThrow(UploadTooLargeError)
    expect(XHRMock.instances.length).toBe(0)
  })

  test("posts a multipart form body with the file to the upload endpoint", async () => {
    installXHRMock()
    const file = new File(["hello"], "hello.txt")
    const request = uploadFile({
      url: "http://localhost/",
      directory: "/proj",
      headers: { "x-test": "1" },
      path: "hello.txt",
      file,
    })

    // Let the promise start so the XHR is constructed, then resolve it.
    await Promise.resolve()
    expect(XHRMock.instances.length).toBe(1)
    const xhr = XHRMock.instances[0]
    expect(xhr.sent).toBe(true)
    expect(xhr.method).toBe("POST")
    expect(xhr.url).toBe("http://localhost/api/fs/upload?path=hello.txt&location%5Bdirectory%5D=%2Fproj")
    // No manual Content-Type: the browser must set the multipart boundary itself.
    expect(xhr.headers).toEqual({ "x-test": "1" })
    const body = xhr.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get("file")).toBe(file)

    xhr.status = 204
    xhr.onload?.()
    await request
  })

  test("reports upload progress through onProgress", async () => {
    installXHRMock()
    const file = new File(["hello"], "hello.txt")
    const seen: number[] = []
    const request = uploadFile({
      url: "http://localhost/",
      directory: "/proj",
      headers: {},
      path: "hello.txt",
      file,
      onProgress: (value) => seen.push(value),
    })

    await Promise.resolve()
    const xhr = XHRMock.instances[0]
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 })
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 })
    expect(seen).toEqual([0.5, 1])

    xhr.status = 204
    xhr.onload?.()
    await request
  })

  test("rejects when the server responds with an error status", async () => {
    installXHRMock()
    const file = new File(["hello"], "hello.txt")
    const request = uploadFile({ url: "http://localhost/", directory: "/proj", headers: {}, path: "hello.txt", file })

    await Promise.resolve()
    const xhr = XHRMock.instances[0]
    xhr.status = 413
    xhr.statusText = "Payload Too Large"
    xhr.responseText = "Request body too large"
    xhr.onload?.()
    await expect(request).rejects.toThrow("Request body too large")
  })

  test("rejects when the request times out", async () => {
    installXHRMock()
    const file = new File(["hello"], "hello.txt")
    const request = uploadFile({ url: "http://localhost/", directory: "/proj", headers: {}, path: "hello.txt", file })

    await Promise.resolve()
    const xhr = XHRMock.instances[0]
    expect(xhr.timeout).toBeGreaterThan(0)
    xhr.ontimeout?.()
    await expect(request).rejects.toThrow("Upload timed out")
  })

  test("scales the XHR timeout with the file size", async () => {
    installXHRMock()
    const small = new File(["x"], "small.bin")
    const request1 = uploadFile({ url: "http://localhost/", directory: "/proj", headers: {}, path: "small.bin", file: small })
    await Promise.resolve()
    const smallTimeout = XHRMock.instances[0].timeout
    xhrDone(XHRMock.instances[0])
    await request1

    installXHRMock()
    // 5 MiB is enough: the timeout is 1 s/MiB, so any size above the 1 MiB
    // ceiling already produces a strictly larger timeout than the baseline.
    const large = new File([new Uint8Array(5 * 1024 * 1024)], "large.bin")
    const request2 = uploadFile({ url: "http://localhost/", directory: "/proj", headers: {}, path: "large.bin", file: large })
    await Promise.resolve()
    expect(XHRMock.instances[0].timeout).toBeGreaterThan(smallTimeout)
    xhrDone(XHRMock.instances[0])
    await request2
  })
})

function xhrDone(xhr: XHRMock) {
  xhr.status = 204
  xhr.onload?.()
}

describe("downloadFile", () => {
  test("requests the download endpoint and triggers an anchor download", async () => {
    const fetchMock = mock((_url: string) => Promise.resolve(new Response(new Blob(["data"]), { status: 200 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const createObjectURL = mock(() => "blob:fake")
    const revokeObjectURL = mock(() => {})
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    const click = mock(() => {})
    HTMLAnchorElement.prototype.click = click

    await downloadFile({ url: "http://localhost:1234/", directory: "/proj", headers: {}, path: "a/b.txt" })

    expect(fetchMock.mock.calls.length).toBe(1)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe("http://localhost:1234/api/fs/download/a/b.txt?location%5Bdirectory%5D=%2Fproj")
    expect(createObjectURL.mock.calls.length).toBe(1)
    expect(click.mock.calls.length).toBe(1)
  })
})
