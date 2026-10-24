"""Reproducible local QLoRA with explicit final-answer supervision.

MLX-LM v0.32.2's public train/evaluate hooks are used without patching the
installed package. No private texts, weights, or run artifacts belong in Git.
"""

import argparse
import gc
import hashlib
import importlib.metadata
import json
import math
import platform
import random
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from .masking import EncodedSample, audit_sample, target_mask, tokenize_sample

LORA_KEYS = [
    "self_attn.q_proj",
    "self_attn.v_proj",
    "linear_attn.in_proj_qkv",
    "linear_attn.in_proj_z",
]


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def read_rows(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as stream:
        for index, line in enumerate(stream, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise TypeError(f"{path}:{index}: expected an object")
            row.setdefault(
                "sampleId", row.get("sample_id", row.get("id", f"{path.name}:{index}"))
            )
            rows.append(row)
    if not rows:
        raise ValueError(f"empty dataset: {path}")
    return rows


def answer_only_loss(model, batch, spans):
    import mlx.core as mx
    from mlx import nn

    logits = model(batch[:, :-1])
    targets = batch[:, 1:]
    positions = mx.arange(1, batch.shape[1])
    mask = (
        (positions >= spans[:, 0:1])
        & (positions < spans[:, 1:2])
        & (positions < spans[:, 2:3])
    )
    token_count = mask.sum()
    losses = nn.losses.cross_entropy(logits, targets).astype(mx.float32)
    return (losses * mask).sum() / token_count, token_count


def explicit_batches(
    dataset, batch_size, max_seq_length, loop=False, seed=42, comm_group=None
):
    """Yield token batches plus [answer start, exclusive end, valid length]."""
    import mlx.core as mx
    import numpy as np

    if comm_group is not None and comm_group.size() != 1:
        raise ValueError("this local runner supports one process only")
    if batch_size < 1 or not dataset:
        raise ValueError("nonempty data and a positive batch size are required")
    rng = random.Random(seed)
    order = sorted(range(len(dataset)), key=lambda index: len(dataset[index].tokens))
    groups = [order[i : i + batch_size] for i in range(0, len(order), batch_size)]
    while True:
        group_order = list(range(len(groups)))
        if loop:
            rng.shuffle(group_order)
        for group in group_order:
            samples: list[EncodedSample] = [dataset[index] for index in groups[group]]
            longest = max(len(sample.tokens) for sample in samples)
            if longest > max_seq_length:
                raise ValueError("iterator refuses to truncate an audited example")
            width = min(max_seq_length, 1 + 32 * ((longest + 31) // 32))
            tokens = np.zeros((len(samples), width), dtype=np.int32)
            spans = []
            for i, sample in enumerate(samples):
                if (
                    not 1
                    <= sample.answer_start
                    < sample.answer_end_exclusive
                    <= len(sample.tokens)
                ):
                    raise ValueError("invalid target span")
                tokens[i, : len(sample.tokens)] = sample.tokens
                spans.append(
                    [
                        sample.answer_start,
                        sample.answer_end_exclusive,
                        len(sample.tokens),
                    ]
                )
            yield mx.array(tokens), mx.array(spans)
        if not loop:
            break


class JsonTrainingLog:
    def __init__(self, path: Path):
        self.path = path

    def emit(self, kind: str, info: dict) -> None:
        for key in ("train_loss", "val_loss"):
            if key in info and not math.isfinite(float(info[key])):
                raise FloatingPointError(f"non-finite {key}")
        item = {"kind": kind, "recordedAt": datetime.now(UTC).isoformat(), **info}
        with self.path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(item, ensure_ascii=False) + "\n")

    def on_train_loss_report(self, info):
        self.emit("train", info)

    def on_val_loss_report(self, info):
        self.emit("validation_before_iteration_update", info)


def swap_observation() -> str | None:
    if sys.platform != "darwin":
        return None
    result = subprocess.run(
        ["sysctl", "-n", "vm.swapusage"], capture_output=True, text=True, check=False
    )
    return result.stdout.strip() if result.returncode == 0 else None


def package_versions() -> dict:
    return {
        name: importlib.metadata.version(name)
        for name in ("mlx-lm", "mlx", "transformers", "numpy", "tokenizers")
    }


def audit_actual_batches(samples: list[EncodedSample], max_seq_length: int) -> int:
    """Check the real iterator's arrays after padding and target shift."""
    expected = {
        (s.tokens, s.answer_start, s.answer_end_exclusive): s.supervised_tokens
        for s in samples
    }
    checked = 0
    for batch, spans in explicit_batches(
        samples, batch_size=1, max_seq_length=max_seq_length
    ):
        row = batch[0].tolist()
        start, end, length = spans[0].tolist()
        mask = target_mask(len(row), start, end, length)
        selected = tuple(token for token, keep in zip(row[1:], mask) if keep)
        if selected != expected[(tuple(row[:length]), start, end)]:
            raise ValueError(
                "actual shifted/padded targets differ from audited answer span"
            )
        checked += 1
    return checked


def run(args) -> dict:
    import mlx.core as mx
    import mlx.optimizers as optim
    from mlx.utils import tree_flatten
    from mlx_lm import load
    from mlx_lm.tuner.trainer import TrainingArgs, evaluate, train
    from mlx_lm.tuner.utils import linear_to_lora_layers
    from mlx_lm.utils import load_tokenizer

    if importlib.metadata.version("mlx-lm") != "0.32.2":
        raise ValueError("this runner is audited against mlx-lm==0.32.2")
    model_path, data_dir, output = (
        Path(args.model).resolve(),
        Path(args.data_dir).resolve(),
        Path(args.output).resolve(),
    )
    if not model_path.is_dir():
        raise ValueError("--model must be a local, revision-pinned model directory")
    if args.iters < 1 or args.accumulation < 1 or args.iters % args.accumulation:
        raise ValueError(
            "iters must be a positive multiple of accumulation; no gradients may be discarded"
        )
    if (
        args.num_layers < 1
        or args.max_seq_length < 2
        or args.val_batches == 0
        or args.val_batches < -1
    ):
        raise ValueError("invalid layer, sequence, or validation configuration")
    if args.limit is not None and args.limit < 1:
        raise ValueError("--limit must be positive")
    output.mkdir(parents=True, exist_ok=False)
    manifest = {
        "schemaVersion": 1,
        "status": "running",
        "runLabel": args.run_label,
        "startedAt": datetime.now(UTC).isoformat(),
        "modelPath": str(model_path),
        "modelRevision": args.model_revision,
        "python": sys.version,
        "platform": platform.platform(),
        "packages": package_versions(),
        "trainSeed": args.seed,
        "generationSeed": None,
        "chatTemplateKwargs": {"enable_thinking": False},
        "microsteps": args.iters,
        "optimizerUpdatesPlanned": args.iters // args.accumulation,
        "batchSize": 1,
        "accumulation": args.accumulation,
        "maxSeqLength": args.max_seq_length,
        "fanReview": "not_asserted_by_training_runner",
        "codeSha256": {
            p.name: file_sha256(p)
            for p in (Path(__file__), Path(__file__).with_name("masking.py"))
        },
        "swapBefore": swap_observation(),
    }
    started = time.monotonic()
    if args.memory_gib <= 0:
        raise ValueError("memory-gib must be positive")
    mx.set_memory_limit(int(args.memory_gib * 1024**3))
    mx.set_cache_limit(256 * 1024**2)
    manifest["memoryGuidelineBytes"] = int(args.memory_gib * 1024**3)
    manifest["memoryGuidelineIsHardCap"] = False
    manifest["cacheLimitBytes"] = 256 * 1024**2
    write_json(output / "manifest.json", manifest)
    try:
        tokenizer = load_tokenizer(model_path, {"trust_remote_code": False})
        datasets = {}
        manifest["data"] = {}
        audits = []
        for split in ("train", "valid"):
            path = data_dir / f"{split}.jsonl"
            rows = read_rows(path)
            if split == "train" and args.limit:
                rows = rows[: args.limit]
            samples = [
                tokenize_sample(tokenizer, row, args.max_seq_length) for row in rows
            ]
            datasets[split] = samples
            manifest["data"][split] = {
                "path": str(path),
                "sha256": file_sha256(path),
                "usedSamples": len(samples),
                "minTokens": min(len(s.tokens) for s in samples),
                "maxTokens": max(len(s.tokens) for s in samples),
                "supervisedTokens": sum(len(s.supervised_tokens) for s in samples),
            }
            audits.extend(
                {
                    "split": split,
                    **audit_sample(
                        tokenizer,
                        s,
                        min(args.max_seq_length, 1 + 32 * ((len(s.tokens) + 31) // 32)),
                    ),
                }
                for s in samples
            )
            manifest["data"][split]["actualShiftedPaddedBatchesChecked"] = (
                audit_actual_batches(samples, args.max_seq_length)
            )
        with (output / "token-audit.jsonl").open("w", encoding="utf-8") as stream:
            for audit in audits:
                stream.write(json.dumps(audit, ensure_ascii=False) + "\n")
        manifest["tokenAuditPassed"] = True
        manifest["modelFiles"] = {
            p.name: file_sha256(p)
            for p in sorted(model_path.iterdir())
            if p.is_file() and (p.suffix in {".json", ".jinja", ".safetensors"})
        }
        if args.audit_only:
            manifest["status"] = "token_audit_complete_no_training"
            return manifest

        mx.random.seed(args.seed)
        model, tokenizer = load(
            str(model_path),
            tokenizer_config={"trust_remote_code": False},
            trust_remote_code=False,
        )
        if args.num_layers > len(model.layers):
            raise ValueError("requested more adapter layers than model has")
        model.freeze()
        lora = {
            "rank": args.rank,
            "scale": args.scale,
            "dropout": 0.0,
            "keys": LORA_KEYS,
        }
        linear_to_lora_layers(model, args.num_layers, lora)
        initial = dict(tree_flatten(model.trainable_parameters()))
        if (
            not initial
            or not any("self_attn" in name for name in initial)
            or not any("linear_attn" in name for name in initial)
        ):
            raise ValueError(
                "both full and linear attention must have trainable adapter weights"
            )
        mx.eval(initial)
        manifest["trainableParameters"] = sum(value.size for value in initial.values())
        manifest["trainableNames"] = sorted(initial)
        adapter_config = {
            "fine_tune_type": "lora",
            "num_layers": args.num_layers,
            "lora_parameters": lora,
            "learning_rate": args.learning_rate,
            "grad_checkpoint": True,
            "mask_prompt": True,
            "loss_implementation": "kiryu_ai.training.answer_only_loss",
        }
        write_json(output / "adapter_config.json", adapter_config)
        manifest["adapterConfig"] = adapter_config
        write_json(output / "manifest.json", manifest)

        def batches(*batch_args, **batch_kwargs):
            batch_kwargs.setdefault("seed", args.seed)
            return explicit_batches(*batch_args, **batch_kwargs)

        optimizer = optim.Adam(learning_rate=args.learning_rate)
        train_args = TrainingArgs(
            batch_size=1,
            iters=args.iters,
            val_batches=args.val_batches,
            steps_per_report=min(8, args.iters),
            steps_per_eval=args.eval_every or args.iters,
            steps_per_save=args.save_every or args.iters,
            adapter_file=output / "adapters.safetensors",
            max_seq_length=args.max_seq_length,
            grad_checkpoint=True,
            grad_accumulation_steps=args.accumulation,
        )
        training_started = time.monotonic()
        train(
            model,
            optimizer,
            datasets["train"],
            datasets["valid"],
            args=train_args,
            loss=answer_only_loss,
            iterate_batches=batches,
            training_callback=JsonTrainingLog(output / "training.jsonl"),
        )
        manifest["trainingSeconds"] = time.monotonic() - training_started
        current = dict(tree_flatten(model.trainable_parameters()))
        delta = sum(
            float(
                mx.sum(
                    mx.square(
                        current[name].astype(mx.float32)
                        - initial[name].astype(mx.float32)
                    )
                ).item()
            )
            for name in initial
        )
        manifest["adapterDeltaSquaredL2"] = delta
        manifest["optimizerUpdatesObserved"] = int(optimizer.step.item())
        if not math.isfinite(delta) or delta <= 0:
            raise ValueError("adapter weights did not change finitely")
        if manifest["optimizerUpdatesObserved"] != args.iters // args.accumulation:
            raise ValueError("unexpected optimizer update count")
        adapter_path = output / "adapters.safetensors"
        saved = mx.load(str(adapter_path))
        if set(saved) != set(current) or not all(
            bool(mx.all(saved[k] == current[k]).item()) for k in current
        ):
            raise ValueError("saved adapter does not exactly match trained parameters")
        manifest["adapterSha256"] = file_sha256(adapter_path)
        manifest["savedWeightsExact"] = True
        manifest["peakMlxBytesBeforeReload"] = mx.get_peak_memory()
        del initial, current, saved, model, optimizer
        gc.collect()
        mx.clear_cache()
        reloaded, _ = load(
            str(model_path),
            adapter_path=str(output),
            tokenizer_config={"trust_remote_code": False},
            trust_remote_code=False,
        )
        final_loss = evaluate(
            reloaded,
            datasets["valid"],
            batch_size=1,
            num_batches=args.val_batches,
            max_seq_length=args.max_seq_length,
            loss=answer_only_loss,
            iterate_batches=batches,
        )
        if not math.isfinite(final_loss):
            raise FloatingPointError("reloaded adapter validation loss is not finite")
        manifest["reloadedValidationLoss"] = final_loss
        manifest["reloadedValidationSamples"] = (
            len(datasets["valid"])
            if args.val_batches == -1
            else min(args.val_batches, len(datasets["valid"]))
        )
        manifest["status"] = "trained_saved_reloaded"
        return manifest
    except BaseException as error:
        manifest["status"] = "failed"
        manifest["error"] = {"type": type(error).__name__, "message": str(error)}
        raise
    finally:
        manifest["elapsedSeconds"] = time.monotonic() - started
        manifest["finishedAt"] = datetime.now(UTC).isoformat()
        manifest["swapAfter"] = swap_observation()
        manifest["peakMlxBytes"] = mx.get_peak_memory()
        write_json(output / "manifest.json", manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--model-revision")
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--iters", type=int, default=400)
    parser.add_argument("--accumulation", type=int, default=8)
    parser.add_argument("--max-seq-length", type=int, default=512)
    parser.add_argument("--memory-gib", type=float, default=12.0)
    parser.add_argument("--num-layers", type=int, default=8)
    parser.add_argument("--rank", type=int, default=8)
    parser.add_argument("--scale", type=float, default=2.0)
    parser.add_argument("--learning-rate", type=float, default=1e-5)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--val-batches", type=int, default=-1)
    parser.add_argument("--eval-every", type=int)
    parser.add_argument("--save-every", type=int)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--audit-only", action="store_true")
    parser.add_argument("--run-label", default="experimental_not_product_approval")
    args = parser.parse_args()
    print(json.dumps(run(args), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
