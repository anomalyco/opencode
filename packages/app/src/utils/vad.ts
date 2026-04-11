import { MicVAD } from "@ricky0123/vad-web"

export type VADCallbacks = {
  onSpeechStart: () => void
  onSpeechEnd: (audio: Float32Array) => void
}

export async function createVAD(callbacks: VADCallbacks) {
  const vad = await MicVAD.new({
    onSpeechStart: callbacks.onSpeechStart,
    onSpeechEnd: (audio) => callbacks.onSpeechEnd(audio),
    positiveSpeechThreshold: 0.6,
    negativeSpeechThreshold: 0.3,
    minSpeechMs: 800,
    preSpeechPadMs: 500,
    redemptionMs: 3000,
    onnxWASMBasePath: "/",
    baseAssetPath: "/",
    model: "legacy",
  })

  return {
    start: () => vad.start(),
    pause: () => vad.pause(),
    destroy: () => vad.destroy(),
  }
}
