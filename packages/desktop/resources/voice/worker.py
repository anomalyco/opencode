"""Persistent MLX STT worker. JSON protocol on stdout; library logs on stderr."""
import contextlib
import json
import os
import sys

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
model = None
for line in sys.stdin:
    request = json.loads(line)
    try:
        with contextlib.redirect_stdout(sys.stderr):
            if model is None:
                from mlx_audio.stt import load
                model = load(sys.argv[1])
            result = model.generate(request["path"], language={"ko": "Korean", "en": "English"}.get(request["language"]))
        text = result.text.strip()
        response = {"id": request["id"], "ok": bool(text), "value": text} if text else {"id": request["id"], "ok": False, "error": "empty"}
    except Exception:
        response = {"id": request["id"], "ok": False, "error": "runtime"}
    print(json.dumps(response, ensure_ascii=False), flush=True)
