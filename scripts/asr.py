#!/usr/bin/env python3
"""
Offline FunASR runner for @1agents/transcribe.

Loads models from <package>/models/ (symlinks to ModelScope cache snapshots).
Outputs char-level JSONL (逐字稿) plus optional sentence JSONL.

Usage:
  .venv/bin/python scripts/asr.py \\
    --audio path/to/media.mp4 \\
    --chars-out analysis/transcript.chars.jsonl \\
    [--sentences-out analysis/transcript.raw.jsonl] \\
    [--fillers-out analysis/transcript.fillers.json] \\
    [--asset-id meeting] \\
    [--no-diarize] [--no-punc]
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = Path(os.environ.get("TRANSCRIBE_MODELS_DIR") or (PACKAGE_ROOT / "models"))


def model_paths(models_dir: Path) -> dict[str, Path]:
    return {
        "asr": models_dir / "seaco_paraformer",
        "vad": models_dir / "fsmn_vad",
        "punc": models_dir / "punc_ct",
        "spk": models_dir / "campplus",
    }


MODEL_PATHS = model_paths(MODELS_DIR)

MODEL_IDS = {
    "asr": "scott887/speech",
    "vad": "damo/speech_fsmn_vad_zh-cn-16k-common-pytorch",
    "punc": "damo/punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
    "spk": "damo/speech_campplus_sv_zh-cn_16k-common",
}

DEFAULT_FILLERS = frozenset({"嗯", "呃", "啊", "哦"})


def die(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def resolve_model(key: str, paths: dict[str, Path] | None = None) -> str:
    local = (paths or MODEL_PATHS)[key]
    if local.exists():
        return str(local.resolve())
    die(
        f"Model missing: {local}\n"
        f"Run: transcribe setup-funasr\n"
        f"(or bash {PACKAGE_ROOT}/scripts/vendor-models.sh)"
    )


def load_wav_16k_mono(path: str):
    import librosa

    try:
        wav, sr = librosa.load(path, sr=16000, mono=True)
        return wav, sr
    except Exception:
        pass

    try:
        import imageio_ffmpeg

        ff = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        ff = "ffmpeg"

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    try:
        subprocess.run(
            [ff, "-y", "-i", path, "-ac", "1", "-ar", "16000", tmp.name],
            check=True,
            capture_output=True,
        )
        wav, sr = librosa.load(tmp.name, sr=16000, mono=True)
        return wav, sr
    except Exception as exc:
        die(f"Failed to load audio {path}: {exc}")
    finally:
        try:
            os.remove(tmp.name)
        except OSError:
            pass


def align_raw_text_to_chars(
    raw_text: str, timestamp: list, asset_id: str
) -> tuple[list[dict[str, Any]], int, int]:
    tokens = [t for t in str(raw_text or "").split() if t]
    ts = timestamp if isinstance(timestamp, list) else []
    n = min(len(tokens), len(ts))
    rows: list[dict[str, Any]] = []
    for i in range(n):
        span = ts[i]
        start = int(round(float(span[0])))
        end = int(round(float(span[1])))
        if end <= start:
            die(f"Invalid timestamp at index {i}: {span}")
        rows.append(
            {
                "i": i,
                "asset": asset_id,
                "text": tokens[i],
                "start": start,
                "end": end,
                "level": "char",
            }
        )
    return rows, n, abs(len(tokens) - len(ts))


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
    path.write_text(body + ("\n" if body else ""), encoding="utf-8")


def sentence_rows(sentence_info: list, asset_id: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, s in enumerate(sentence_info or []):
        if not isinstance(s, dict):
            continue
        out.append(
            {
                "i": i,
                "asset": asset_id,
                "text": str(s.get("text") or "").strip(),
                "start": s.get("start"),
                "end": s.get("end"),
                "spk": s.get("spk", None),
            }
        )
    return out


def build_model(*, diarize: bool, punc: bool, paths: dict[str, Path] | None = None):
    from funasr import AutoModel

    p = paths or MODEL_PATHS
    kwargs: dict[str, Any] = {
        "model": resolve_model("asr", p),
        "vad_model": resolve_model("vad", p),
        "disable_update": True,
    }
    if punc:
        kwargs["punc_model"] = resolve_model("punc", p)
    if diarize:
        kwargs["spk_model"] = resolve_model("spk", p)
    return AutoModel(**kwargs)


def run_asr(
    wav, *, diarize: bool, punc: bool, paths: dict[str, Path] | None = None
) -> dict[str, Any]:
    model = build_model(diarize=diarize, punc=punc, paths=paths)
    gen_kwargs: dict[str, Any] = {
        "input": wav,
        "batch_size_s": 300,
        "sentence_timestamp": True,
        "return_raw_text": True,
        "is_final": True,
        "cache": {},
        "return_spk_res": bool(diarize),
    }

    res = model.generate(**gen_kwargs)[0]
    return {
        "raw_text": res.get("raw_text") or "",
        "timestamp": res.get("timestamp") or [],
        "text": res.get("text") or "",
        "sentence_info": res.get("sentence_info") or [],
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Offline FunASR (chars + optional diarization)")
    p.add_argument("--audio", required=True, help="Audio or video path")
    p.add_argument("--chars-out", required=True, help="Write transcript.chars.jsonl")
    p.add_argument("--sentences-out", default=None, help="Optional sentence-level jsonl")
    p.add_argument("--fillers-out", default=None, help="Optional fillers summary JSON")
    p.add_argument("--asset-id", default="meeting")
    p.add_argument(
        "--no-diarize",
        action="store_true",
        help="Disable campplus speaker diarization (default: on)",
    )
    p.add_argument(
        "--no-punc",
        action="store_true",
        help="Disable CT punctuation model",
    )
    p.add_argument(
        "--models-dir",
        default=None,
        help="Override models directory (default: <package>/models)",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    audio = Path(args.audio)
    if not audio.is_file():
        die(f"Audio not found: {audio}")

    models_dir = Path(args.models_dir) if args.models_dir else MODELS_DIR
    paths = model_paths(models_dir)

    diarize = not args.no_diarize
    punc = not args.no_punc
    wav, _sr = load_wav_16k_mono(str(audio.resolve()))
    result = run_asr(wav, diarize=diarize, punc=punc, paths=paths)

    rows, token_count, token_ts_delta = align_raw_text_to_chars(
        result["raw_text"], result["timestamp"], args.asset_id
    )
    chars_path = Path(args.chars_out)
    write_jsonl(chars_path, rows)

    sentences_path = None
    if args.sentences_out:
        sentences_path = Path(args.sentences_out)
        write_jsonl(sentences_path, sentence_rows(result["sentence_info"], args.asset_id))

    fillers = [r for r in rows if r["text"] in DEFAULT_FILLERS]
    fillers_path = None
    if args.fillers_out:
        fillers_path = Path(args.fillers_out)
        fillers_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "ok": True,
            "model": MODEL_IDS["asr"],
            "vad_model": MODEL_IDS["vad"],
            "punc_model": MODEL_IDS["punc"] if punc else None,
            "spk_model": MODEL_IDS["spk"] if diarize else None,
            "diarize": diarize,
            "has_char_timestamps": True,
            "token_count": token_count,
            "token_ts_delta": token_ts_delta,
            "sentence_count": len(result["sentence_info"] or []),
            "fillers": fillers,
            "models_dir": str(models_dir.resolve()),
        }
        fillers_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    print(
        json.dumps(
            {
                "ok": True,
                "charsOut": str(chars_path.resolve()),
                "tokenCount": token_count,
                "tokenTsDelta": token_ts_delta,
                "fillers": len(fillers),
                "diarize": diarize,
                "sentenceCount": len(result["sentence_info"] or []),
                "sentencesOut": str(sentences_path.resolve()) if sentences_path else None,
                "fillersOut": str(fillers_path.resolve()) if fillers_path else None,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
