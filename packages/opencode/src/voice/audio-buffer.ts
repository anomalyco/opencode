export class AudioBuffer {
  private chunks: Buffer[] = []
  private totalDuration = 0 // in seconds
  private sampleRate: number
  private channels: number

  constructor(sampleRate = 16000, channels = 1) {
    this.sampleRate = sampleRate
    this.channels = channels
  }

  append(chunk: Buffer) {
    this.chunks.push(chunk)
    // Assuming 16-bit PCM audio
    const samples = chunk.length / 2
    this.totalDuration += samples / this.sampleRate
  }

  getDuration(): number {
    return this.totalDuration
  }

  getBuffer(): Buffer {
    return Buffer.concat(this.chunks)
  }

  clear() {
    this.chunks = []
    this.totalDuration = 0
  }

  isEmpty(): boolean {
    return this.chunks.length === 0
  }

  toWav(): Buffer {
    const audioData = this.getBuffer()
    const dataLength = audioData.length
    const header = Buffer.alloc(44)

    // RIFF header
    header.write("RIFF", 0)
    header.writeUInt32LE(36 + dataLength, 4)
    header.write("WAVE", 8)

    // fmt chunk
    header.write("fmt ", 12)
    header.writeUInt32LE(16, 16) // chunk size
    header.writeUInt16LE(1, 20) // audio format (PCM)
    header.writeUInt16LE(this.channels, 22)
    header.writeUInt32LE(this.sampleRate, 24)
    header.writeUInt32LE(this.sampleRate * this.channels * 2, 28) // byte rate
    header.writeUInt16LE(this.channels * 2, 32) // block align
    header.writeUInt16LE(16, 34) // bits per sample

    // data chunk
    header.write("data", 36)
    header.writeUInt32LE(dataLength, 40)

    return Buffer.concat([header, audioData])
  }
}
