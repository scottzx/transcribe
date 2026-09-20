#!/usr/bin/env python3
"""Download FunASR weights into <package>/models/.

All four components live in one ModelScope repo:
  https://modelscope.cn/models/scott887/speech
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = Path(os.environ.get("TRANSCRIBE_MODELS_DIR") or (PACKAGE_ROOT / "models"))

BUNDLE_REPO = "scott887/speech"
COMPONENTS = (
    ("seaco_paraformer", "iic--speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"),
    ("fsmn_vad", "damo--speech_fsmn_vad_zh-cn-16k-common-pytorch"),
    ("punc_ct", "damo--punc_ct-transformer_zh-cn-common-vocab272727-pytorch"),
    ("campplus", "damo--speech_campplus_sv_zh-cn_16k-common"),
)


def is_ready(path: Path) -> bool:
    return (path / "configuration.json").exists() or (path / "config.yaml").exists()


def component_dir(root: Path, cache_name: str) -> Path | None:
    snapshots = root / cache_name / "snapshots"
    candidates = [root / cache_name / "snapshots" / "master", root / cache_name]
    if snapshots.is_dir():
        newest = sorted(
            (p for p in snapshots.iterdir() if p.is_dir()),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        candidates.extend(newest)
    for cand in candidates:
        if is_ready(cand):
            return cand
    return None


def link_or_copy(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_symlink() or dest.is_file():
        dest.unlink()
    elif dest.is_dir():
        if is_ready(dest) and os.environ.get("FORCE") != "1":
            print(f"SKIP  {dest.name} (already present)")
            return
        if os.environ.get("FORCE") == "1" or not any(dest.iterdir()):
            shutil.rmtree(dest, ignore_errors=True)
        else:
            print(f"SKIP  {dest.name} (exists, not empty) set FORCE=1 to replace", file=sys.stderr)
            return
    os.symlink(src, dest)
    print(f"LINK  {dest.name} -> {src}")


def main() -> int:
    try:
        from modelscope.hub.snapshot_download import snapshot_download
    except Exception as exc:
        print(f"modelscope is required: {exc}\nRun: transcribe setup-funasr", file=sys.stderr)
        return 1

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    missing = [name for name, _ in COMPONENTS if not is_ready(MODELS_DIR / name)]
    if not missing and os.environ.get("FORCE") != "1":
        print(f"ready models_dir={MODELS_DIR}")
        return 0

    print(f"DOWNLOAD  {BUNDLE_REPO}")
    bundle = Path(snapshot_download(BUNDLE_REPO))
    for name, cache_name in COMPONENTS:
        dest = MODELS_DIR / name
        if is_ready(dest) and os.environ.get("FORCE") != "1":
            print(f"SKIP  {name} (ready)")
            continue
        src = component_dir(bundle, cache_name)
        if src is None:
            print(f"Bundle missing component {name} ({cache_name}) under {bundle}", file=sys.stderr)
            return 1
        link_or_copy(src, dest)

    still = [name for name, _ in COMPONENTS if not is_ready(MODELS_DIR / name)]
    if still:
        print(f"missing: {', '.join(still)}", file=sys.stderr)
        return 1
    print(f"ready models_dir={MODELS_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
