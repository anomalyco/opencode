#!/usr/bin/env python3
"""
Аудио транскрибатор с использованием Whisper large-v3 и GPU
"""

import argparse
from pathlib import Path
from faster_whisper import WhisperModel


def transcribe(audio_path: str, output_path: str | None = None, language: str = "ru") -> str:
    """
    Транскрибирует аудиофайл в текст.
    
    Args:
        audio_path: Путь к аудиофайлу
        output_path: Путь для сохранения текста (опционально)
        language: Язык аудио (по умолчанию "ru")
    
    Returns:
        Транскрибированный текст
    """
    audio_file = Path(audio_path)
    if not audio_file.exists():
        raise FileNotFoundError(f"Аудиофайл не найден: {audio_path}")
    
    print(f"Загрузка модели large-v3...")
    try:
        import ctranslate2
        # Попытка использовать GPU
        model = WhisperModel(
            "large-v3",
            device="auto",
            compute_type="float16"
        )
    except:
        model = WhisperModel(
            "large-v3",
            device="cpu",
            compute_type="int8"
        )
    
    print(f"Транскрибация: {audio_path}")
    segments, info = model.transcribe(
        audio_path,
        language=language,
        beam_size=5,
        vad_filter=True
    )
    
    text = "".join(segment.text for segment in segments)
    
    if output_path:
        Path(output_path).write_text(text, encoding="utf-8")
        print(f"Результат сохранён: {output_path}")
    else:
        print("\n" + "=" * 50)
        print(text)
        print("=" * 50)
    
    return text


def main():
    parser = argparse.ArgumentParser(description="Транскрибация аудио с помощью Whisper large-v3")
    parser.add_argument("audio", help="Путь к аудиофайлу")
    parser.add_argument("-o", "--output", help="Путь для сохранения текста")
    parser.add_argument("-l", "--language", default="ru", help="Язык (по умолчанию: ru)")
    
    args = parser.parse_args()
    transcribe(args.audio, args.output, args.language)


if __name__ == "__main__":
    main()
