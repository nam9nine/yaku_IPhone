"""Download pinned local models without executing repository code."""

import argparse
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

MODELS = {
    "9b": {
        "repo": "mlx-community/Qwen3.5-9B-4bit",
        "revision": "8b2b98c00a6b4d291155e4890773ca8f769aee53",
        "upstream": "Qwen/Qwen3.5-9B",
        "upstream_revision": "c202236235762e1c871ad0ccb60c8ee5ba337b9a",
    },
    "4b": {
        "repo": "mlx-community/Qwen3.5-4B-4bit",
        "revision": "0e7ffd5c629ef7719d4cbc04069232580bfa9d9c",
        "upstream": "Qwen/Qwen3.5-4B",
        "upstream_revision": "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a",
    },
}


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def download(name, output):
    from huggingface_hub import snapshot_download

    spec = MODELS[name]
    target = Path(output) / name
    snapshot_download(
        repo_id=spec["repo"],
        revision=spec["revision"],
        local_dir=target,
        allow_patterns=[
            "*.json",
            "*.safetensors",
            "*.jinja",
            "*.model",
            "README.md",
            "LICENSE*",
        ],
        max_workers=2,
    )
    files = [p for p in target.iterdir() if p.is_file() and p.name != "receipt.json"]
    receipt = {
        **spec,
        "downloaded_at": datetime.now(UTC).isoformat(),
        "files": [
            {"path": p.name, "bytes": p.stat().st_size, "sha256": sha256(p)}
            for p in sorted(files)
        ],
    }
    (target / "receipt.json").write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2) + "\n"
    )
    print(
        json.dumps(
            {
                "model": name,
                "path": str(target),
                "files": len(files),
                "bytes": sum(p.stat().st_size for p in files),
            }
        ),
        flush=True,
    )
    return target


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", choices=[*MODELS, "all"], default="all")
    p.add_argument("--output", required=True)
    args = p.parse_args()
    for name in MODELS if args.model == "all" else [args.model]:
        download(name, args.output)


if __name__ == "__main__":
    main()
