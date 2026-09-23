import type { Stream } from "effect"
import { Speech, type SpeechEvent } from "../src/index.js"
import { ElevenLabs, OpenAI, Runway } from "../src/providers.js"

type StreamItem<T> = T extends Stream.Stream<infer A, infer _E, infer _R> ? A : never
type Equal<A, B> = [A, B] extends [B, A] ? true : false
type Assert<T extends true> = T

const elevenlabs = ElevenLabs.configure({ apiKey: "test" }).speech("eleven_flash_v2_5")

Speech.generate({
  model: elevenlabs,
  text: "Hello",
  voice: "JBFqnCBsd6RMkjVDRZzb",
  format: "future-format",
  providerOptions: { outputFormat: "future_format", voice_settings: { stability: 0.4 }, futureOption: true },
})
Speech.stream({ model: OpenAI.configure({ apiKey: "test" }).speech("gpt-4o-mini-tts"), text: "Hi", voice: { id: "v" } })

// @ts-expect-error Known provider options are inferred from the selected model.
Speech.generate({ model: elevenlabs, text: "Hello", providerOptions: { voice_settings: { stability: "high" } } })
// @ts-expect-error Voices are provider-native strings or `{ id }` objects.
Speech.generate({ model: elevenlabs, text: "Hello", voice: { name: "George" } })
// @ts-expect-error Image models cannot be used for speech requests.
Speech.request({ model: OpenAI.configure({ apiKey: "test" }).image("gpt-image-2"), text: "Hello" })
// @ts-expect-error Video models cannot be used for speech requests.
Speech.request({ model: Runway.configure({ apiKey: "test" }).video("gen4.5"), text: "Hello" })

const streamed = Speech.stream({ model: elevenlabs, text: "Hello" })
type StreamEvent = Assert<Equal<StreamItem<typeof streamed>, SpeechEvent>>
void (true satisfies StreamEvent)
