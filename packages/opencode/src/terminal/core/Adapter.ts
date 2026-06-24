import { OutputParser } from "./OutputParser"
import { DoubleBuffer } from "../buffer/DoubleBuffer"
import { OutputChannel } from "../buffer/OutputChannel"
import { SgrDelta } from "./SgrDelta"
import { AnsiCodes } from "../utils/AnsiCodes"

export class Adapter {
  private parser = new OutputParser()
  private sgrDelta = new SgrDelta()
  private doubleBuffer: DoubleBuffer
  private output: OutputChannel

  constructor(doubleBuffer: DoubleBuffer, output: OutputChannel) {
    this.doubleBuffer = doubleBuffer
    this.output = output
  }

  writeAI(bytes: Uint8Array): boolean {
    const buf = this.doubleBuffer.getBack()
    buf.clear()
    this.parser.parseAndWrite(buf, bytes)
    const diff = this.doubleBuffer.swap()
    const optimized = this.sgrDelta.optimize(diff)
    return this.output.write(AnsiCodes.cursorHome + optimized)
  }
}
