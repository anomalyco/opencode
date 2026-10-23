// Minimal streaming Matroska writer for timestamped MJPEG frames.
// References: https://www.matroska.org/technical/elements.html and RFC 8794.

const ebml = Buffer.from("1A45DFA3", "hex")
const ebmlVersion = Buffer.from("4286", "hex")
const ebmlReadVersion = Buffer.from("42F7", "hex")
const ebmlMaxIdLength = Buffer.from("42F2", "hex")
const ebmlMaxSizeLength = Buffer.from("42F3", "hex")
const docType = Buffer.from("4282", "hex")
const docTypeVersion = Buffer.from("4287", "hex")
const docTypeReadVersion = Buffer.from("4285", "hex")
const segment = Buffer.from("18538067", "hex")
const info = Buffer.from("1549A966", "hex")
const timestampScale = Buffer.from("2AD7B1", "hex")
const muxingApp = Buffer.from("4D80", "hex")
const writingApp = Buffer.from("5741", "hex")
const tracks = Buffer.from("1654AE6B", "hex")
const trackEntry = Buffer.from("AE", "hex")
const trackNumber = Buffer.from("D7", "hex")
const trackUid = Buffer.from("73C5", "hex")
const trackType = Buffer.from("83", "hex")
const flagLacing = Buffer.from("9C", "hex")
const codecId = Buffer.from("86", "hex")
const video = Buffer.from("E0", "hex")
const pixelWidth = Buffer.from("B0", "hex")
const pixelHeight = Buffer.from("BA", "hex")
const cluster = Buffer.from("1F43B675", "hex")
const timestamp = Buffer.from("E7", "hex")
const blockGroup = Buffer.from("A0", "hex")
const block = Buffer.from("A1", "hex")
const blockDuration = Buffer.from("9B", "hex")
const unknownSize = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])

function variableInteger(value: number): Buffer {
  let length = 1
  while (value >= 2 ** (7 * length) - 1) length += 1
  const buffer = Buffer.alloc(length)
  let remaining = value
  for (let index = length - 1; index >= 0; index -= 1) {
    buffer[index] = remaining & 0xff
    remaining = Math.floor(remaining / 256)
  }
  buffer[0] = (buffer[0] ?? 0) | (1 << (8 - length))
  return buffer
}

function unsignedInteger(value: number): Buffer {
  if (value === 0) return Buffer.from([0])
  const bytes: number[] = []
  let remaining = value
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff)
    remaining = Math.floor(remaining / 256)
  }
  return Buffer.from(bytes)
}

function element(id: Buffer, payload: Buffer): Buffer {
  return Buffer.concat([id, variableInteger(payload.length), payload])
}

export function mjpegMatroskaHeader(width: number, height: number): Buffer {
  const ebmlHeader = element(ebml, Buffer.concat([
    element(ebmlVersion, unsignedInteger(1)),
    element(ebmlReadVersion, unsignedInteger(1)),
    element(ebmlMaxIdLength, unsignedInteger(4)),
    element(ebmlMaxSizeLength, unsignedInteger(8)),
    element(docType, Buffer.from("matroska")),
    element(docTypeVersion, unsignedInteger(4)),
    element(docTypeReadVersion, unsignedInteger(2)),
  ]))
  const streamInfo = element(info, Buffer.concat([
    element(timestampScale, unsignedInteger(1_000_000)),
    element(muxingApp, Buffer.from("opencode-browser")),
    element(writingApp, Buffer.from("opencode-browser")),
  ]))
  const track = element(trackEntry, Buffer.concat([
    element(trackNumber, unsignedInteger(1)),
    element(trackUid, unsignedInteger(1)),
    element(trackType, unsignedInteger(1)),
    element(flagLacing, unsignedInteger(0)),
    element(codecId, Buffer.from("V_MJPEG")),
    element(video, Buffer.concat([
      element(pixelWidth, unsignedInteger(width)),
      element(pixelHeight, unsignedInteger(height)),
    ])),
  ]))
  return Buffer.concat([ebmlHeader, segment, unknownSize, streamInfo, element(tracks, track)])
}

export function mjpegMatroskaFrame(timestampMs: number, durationMs: number, frameLength: number): {
  readonly header: Buffer
  readonly trailer: Buffer
} {
  const blockHeader = Buffer.concat([
    block,
    variableInteger(4 + frameLength),
    variableInteger(1),
    Buffer.from([0x00, 0x00]),
    Buffer.from([0x00]),
  ])
  const clusterTimestamp = element(timestamp, unsignedInteger(timestampMs))
  const duration = element(blockDuration, unsignedInteger(Math.max(1, durationMs)))
  const groupHeader = Buffer.concat([
    blockGroup,
    variableInteger(blockHeader.length + frameLength + duration.length),
    blockHeader,
  ])
  return {
    header: Buffer.concat([
      cluster,
      variableInteger(clusterTimestamp.length + groupHeader.length + frameLength + duration.length),
      clusterTimestamp,
      groupHeader,
    ]),
    trailer: duration,
  }
}
