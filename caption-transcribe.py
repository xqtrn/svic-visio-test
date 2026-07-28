#!/usr/bin/env python3
"""Transcribe one or more audio chunks with one cached faster-whisper model."""
import json
import os
import sys

from faster_whisper import WhisperModel


def main() -> None:
    model_name = os.environ.get("WHISPER_MODEL", "small")
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    results = []
    for filename in sys.argv[1:]:
        segments, info = model.transcribe(
            filename,
            beam_size=5,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
        )
        results.append({
            "language": info.language,
            "segments": [
                {"start": segment.start, "end": segment.end, "text": segment.text}
                for segment in segments
            ],
        })
    sys.stdout.write(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()
