import { NativeError, NativeStatus, OptimizedBuffer } from "@opentui/core"

// Workaround: OpenTUI's test renderer can read a frame while the native writer is still flushing
// output, which throws OutputBusy until the event loop runs. Frame reads poll, so fall back to the
// last frame read from the buffer. Remove once captureCharFrame waits for output idle upstream.
const frames = new WeakMap<OptimizedBuffer, Uint8Array>()
const getRealCharBytes = OptimizedBuffer.prototype.getRealCharBytes
OptimizedBuffer.prototype.getRealCharBytes = function (addLineBreaks) {
  try {
    const bytes = getRealCharBytes.call(this, addLineBreaks)
    frames.set(this, bytes)
    return bytes
  } catch (error) {
    if (!(error instanceof NativeError) || error.status !== NativeStatus.OutputBusy) throw error
    return frames.get(this) ?? new Uint8Array()
  }
}
