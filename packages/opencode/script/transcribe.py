import argparse
import json

from faster_whisper import WhisperModel


parser = argparse.ArgumentParser()
parser.add_argument("--file", required=True)
parser.add_argument("--model", default="medium")
parser.add_argument("--language")
args = parser.parse_args()

model = WhisperModel(args.model, device="cpu", compute_type="int8")
segments, _ = model.transcribe(
    args.file,
    language=args.language or "ru",
    beam_size=5,
    condition_on_previous_text=False,
    compression_ratio_threshold=2.4,
    log_prob_threshold=-1.0,
    no_speech_threshold=0.6,
    vad_filter=True,
)
print(json.dumps({"text": " ".join(segment.text.strip() for segment in segments).strip()}))
