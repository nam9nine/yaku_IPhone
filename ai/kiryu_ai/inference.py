"""A single-model local inference runner with explicit request timing and no shared KV cache."""

import argparse
import hashlib
import json
import platform
import time
from datetime import UTC, datetime
from pathlib import Path

from .models import sha256


def artifact_hashes(directory):
    """Hash the local files actually loaded, not only a mutable path or receipt."""
    root = Path(directory)
    files = sorted(
        path
        for path in root.iterdir()
        if path.is_file()
        and path.suffix in {".safetensors", ".json", ".jinja", ".model"}
    )
    if not any(path.suffix == ".safetensors" for path in files):
        raise ValueError(f"No local weights found in {root}")
    return {path.name: sha256(path) for path in files}


def jsonl(path):
    return [
        json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()
    ]


class LocalModel:
    def __init__(self, model_path, adapter=None):
        import mlx.core as mx
        from mlx_lm import load

        self.mx = mx
        mx.set_cache_limit(256 * 1024**2)
        started = time.perf_counter()
        self.model, self.tokenizer = load(
            str(model_path),
            adapter_path=str(adapter) if adapter else None,
            trust_remote_code=False,
        )
        mx.eval(self.model.parameters())
        self.load_seconds = time.perf_counter() - started
        self.model_path = str(model_path)
        self.adapter = str(adapter) if adapter else None

    def reply(
        self, messages, *, seed=42, max_tokens=128, temperature=0.7, top_p=0.8, top_k=20
    ):
        from mlx_lm import stream_generate
        from mlx_lm.sample_utils import make_logits_processors, make_sampler

        from .masking import render_prompt

        prompt = render_prompt(self.tokenizer, messages)
        if len(prompt) + max_tokens > 2048:
            raise ValueError(
                "Prompt plus output budget exceeds this runner's 2048-token limit"
            )
        self.mx.random.seed(seed)
        self.mx.reset_peak_memory()
        started = time.perf_counter()
        first_token = None
        first_text = None
        chunks = []
        last = None
        # Each call constructs a fresh cache. A request never reuses another visitor's KV state.
        for result in stream_generate(
            self.model,
            self.tokenizer,
            prompt=prompt,
            max_tokens=max_tokens,
            sampler=make_sampler(temp=temperature, top_p=top_p, top_k=top_k),
            logits_processors=make_logits_processors(
                presence_penalty=1.5, repetition_penalty=1.0
            ),
        ):
            elapsed = time.perf_counter() - started
            if first_token is None:
                first_token = elapsed
            if result.text and first_text is None:
                first_text = elapsed
            chunks.append(result.text)
            last = result
        if last is None:
            raise RuntimeError("Model produced no generation result")
        output = "".join(chunks)
        elapsed = time.perf_counter() - started
        return {
            "reply": output,
            "prompt_tokens": len(prompt),
            "prompt_sha256": hashlib.sha256(json.dumps(prompt).encode()).hexdigest(),
            "generation_tokens": last.generation_tokens,
            "finish_reason": last.finish_reason,
            "ttft_seconds": first_token,
            "first_text_seconds": first_text,
            "total_seconds": elapsed,
            "generation_tokens_per_second": last.generation_tps,
            "peak_memory_bytes": self.mx.get_peak_memory(),
            "generation_seed": seed,
            "sampling": {
                "temperature": temperature,
                "top_p": top_p,
                "top_k": top_k,
                "presence_penalty": 1.5,
                "repetition_penalty": 1.0,
                "max_tokens": max_tokens,
            },
            "stop_policy": "native model EOS; max_tokens is reported as length, not success",
            "prompt_cache": "fresh_per_request",
        }


def run_batch(args):
    requests = jsonl(args.requests)
    if args.limit is not None:
        requests = requests[: args.limit]
    if not requests:
        raise ValueError("At least one inference request is required")
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists() or output.with_suffix(".manifest.json").exists():
        raise FileExistsError(
            f"Refusing to overwrite existing inference evidence or manifest: {output}"
        )
    model_files = artifact_hashes(args.model)
    adapter_files = artifact_hashes(args.adapter) if args.adapter else None
    engine = LocalModel(args.model, args.adapter)
    header = {
        "started_at": datetime.now(UTC).isoformat(),
        "model": args.model,
        "adapter": args.adapter,
        "model_load_seconds": engine.load_seconds,
        "platform": platform.platform(),
        "python": platform.python_version(),
        "executor": "one process, one loaded model, sequential FIFO; fresh KV cache per request",
        "burst": args.burst,
        "request_count": len(requests),
        "loading_included_in_request_latency": False,
        "requests_sha256": hashlib.sha256(Path(args.requests).read_bytes()).hexdigest(),
        "code_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "model_files": model_files,
        "adapter_files": adapter_files,
        "serialization_sha256": sha256(Path(__file__).with_name("masking.py")),
        "cache_limit_bytes": 256 * 1024**2,
    }
    output.with_suffix(".manifest.json").write_text(
        json.dumps(header, ensure_ascii=False, indent=2) + "\n"
    )
    errors = 0
    with output.open("x") as destination:
        for index, request in enumerate(requests):
            if index % args.burst == 0:
                arrival = time.perf_counter()
            start = time.perf_counter()
            common = {
                "sample_id": request.get(
                    "sample_id", request.get("sampleId", str(index))
                ),
                "character_id": request.get("character_id", request.get("characterId")),
                "condition": request.get("condition", "provided_messages"),
                "queue_seconds": start - arrival,
                "request_index": index,
                "input_sha256": request.get("input_sha256"),
                "profile_sha256": request.get("profile_sha256"),
                "fact_ids": request.get("fact_ids", []),
            }
            try:
                result = engine.reply(
                    request["messages"],
                    seed=args.seed + index,
                    max_tokens=args.max_tokens,
                    temperature=args.temperature,
                    top_p=args.top_p,
                    top_k=args.top_k,
                )
                row = {
                    **common,
                    **result,
                    "arrival_to_finish_seconds": time.perf_counter() - arrival,
                    "status": "ok",
                }
            except (ValueError, RuntimeError, KeyError, TypeError) as error:
                errors += 1
                row = {
                    **common,
                    "status": "error",
                    "error": f"{type(error).__name__}: {error}",
                }
            destination.write(json.dumps(row, ensure_ascii=False) + "\n")
            destination.flush()
            print(
                json.dumps(
                    {
                        "index": index,
                        "status": row["status"],
                        "seconds": row.get("total_seconds"),
                        "reply": row.get("reply"),
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
    if errors:
        raise RuntimeError(f"{errors} inference requests failed; see {output}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--adapter")
    parser.add_argument("--requests", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--burst", type=int, default=1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-tokens", type=int, default=128)
    parser.add_argument("--temperature", type=float, default=0.7)
    parser.add_argument("--top-p", type=float, default=0.8)
    parser.add_argument("--top-k", type=int, default=20)
    args = parser.parse_args()
    if args.burst < 1 or args.max_tokens < 1:
        parser.error("burst and max-tokens must be positive")
    run_batch(args)


if __name__ == "__main__":
    main()
