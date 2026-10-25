"""Fetch only pinned model/runtime artifacts; verify before any binary runs."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import subprocess
import tarfile
from datetime import UTC, datetime
from pathlib import Path

LLAMA_VERSION = "v0.7.0"
LLAMA_COMMIT = "620d2225cc436ab0b001e3200e590e3b286ef9ab"
# v0.7.0's official nightly-tag.txt points to b11669, with the same commit.
BINARY_TAG = "b11669"
BINARY_FILE = "llama-b11669-bin-macos-arm64.tar.gz"
BINARY_SHA256 = "dbed55493d72bc1ba2babc8770d669c2289b5bc4ee9fb2a4dfc158d45b7d13fd"
MODEL_REPO = "lmstudio-community/gemma-4-26B-A4B-it-GGUF"
MODEL_REVISION = "f6e6747823b2912661935db7e0009287c4838073"
MODEL_FILE = "gemma-4-26B-A4B-it-Q4_K_M.gguf"
MODEL_BYTES = 16_796_017_248
MODEL_SHA256 = "e19514d9541344001cb7c8eaf88704b8bf2e5d8f4e9aac12402eed360cffdfc4"


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_binary(directory):
    """Check extracted files against the pinned archive, including on re-install."""
    directory = Path(directory)
    archive = directory / BINARY_FILE
    if sha256(archive) != BINARY_SHA256:
        raise ValueError("Runtime archive SHA-256 mismatch")
    with tarfile.open(archive) as package:
        for member in package.getmembers():
            target = directory / member.name
            if member.isfile():
                if target.is_symlink() or not target.is_file():
                    raise ValueError("Runtime file missing or replaced: " + member.name)
                original = package.extractfile(member)
                if hashlib.sha256(original.read()).hexdigest() != sha256(target):
                    raise ValueError(
                        "Runtime file differs from archive: " + member.name
                    )
            elif member.issym():
                if not target.is_symlink() or os.readlink(target) != member.linkname:
                    raise ValueError("Runtime library link differs: " + member.name)


def verify_runtime(directory, executable, model):
    directory = Path(directory).resolve()
    if Path(executable).resolve() != directory / "llama-b11669" / "llama-server":
        raise ValueError("Expected pinned llama-server path")
    if Path(model).resolve() != directory / MODEL_FILE:
        raise ValueError("Expected pinned model path")
    verify_binary(directory)
    if Path(model).stat().st_size != MODEL_BYTES or sha256(model) != MODEL_SHA256:
        raise ValueError("Model SHA-256 mismatch")


def fetch(url, output, expected_sha256, expected_size=None):
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        if (expected_size is None or output.stat().st_size == expected_size) and (
            sha256(output) == expected_sha256
        ):
            return output
        raise ValueError("Existing artifact failed verification: " + output.name)
    partial = output.with_name(output.name + ".part")
    if (
        partial.exists()
        and expected_size is not None
        and partial.stat().st_size == expected_size
        and sha256(partial) == expected_sha256
    ):
        partial.replace(output)
        return output
    # curl resumes an interrupted download. An invalid artifact is left for
    # diagnosis; it is never executed and is not silently overwritten.
    subprocess.run(
        [
            "curl",
            "--fail",
            "--location",
            "--show-error",
            "--retry",
            "3",
            "--continue-at",
            "-",
            "--output",
            str(partial),
            url,
        ],
        check=True,
    )
    if expected_size is not None and partial.stat().st_size != expected_size:
        raise ValueError("Artifact length mismatch: " + output.name)
    if sha256(partial) != expected_sha256:
        raise ValueError("Artifact SHA-256 mismatch: " + output.name)
    partial.replace(output)
    return output


def install(directory):
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise ValueError("This pinned runtime is for Apple Silicon macOS")
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    archive = fetch(
        f"https://github.com/ggml-org/llama.cpp/releases/download/{BINARY_TAG}/{BINARY_FILE}",
        directory / BINARY_FILE,
        BINARY_SHA256,
    )
    binary_dir = directory / "llama-b11669"
    if not binary_dir.exists():
        with tarfile.open(archive) as package:
            package.extractall(directory, filter="data")
    verify_binary(directory)
    executable = binary_dir / "llama-server"
    if not executable.is_file() or not os.access(executable, os.X_OK):
        raise ValueError("Official archive lacks an executable llama-server")
    model = fetch(
        f"https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REVISION}/{MODEL_FILE}",
        directory / MODEL_FILE,
        MODEL_SHA256,
        MODEL_BYTES,
    )
    files = [
        {
            "path": str(path.relative_to(directory)),
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        }
        for path in sorted(binary_dir.iterdir())
        if path.is_file() and not path.is_symlink()
    ]
    manifest = {
        "schema_version": 1,
        "created_at": datetime.now(UTC).isoformat(),
        "llama_version": LLAMA_VERSION,
        "llama_commit": LLAMA_COMMIT,
        "binary_tag": BINARY_TAG,
        "archive_sha256": BINARY_SHA256,
        "model_repo": MODEL_REPO,
        "model_revision": MODEL_REVISION,
        "model_file": model.name,
        "model_bytes": MODEL_BYTES,
        "model_sha256": MODEL_SHA256,
        "files": files,
        "executable": str(executable.relative_to(directory)),
        "template_sha256": None,
        "template_note": "Recorded from the running server before first generation",
    }
    target = directory / "runtime-manifest.json"
    temporary = target.with_suffix(".tmp")
    with os.fdopen(
        os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600),
        "w",
        encoding="utf-8",
    ) as output:
        json.dump(manifest, output, ensure_ascii=False, indent=2)
        output.write("\n")
    temporary.replace(target)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True)
    args = parser.parse_args()
    manifest = install(args.directory)
    print(
        json.dumps(
            {"llama_version": LLAMA_VERSION, "model_sha256": manifest["model_sha256"]}
        )
    )


if __name__ == "__main__":
    main()
