"""Bounded, local CPU transcription of one already-saved microphone clip."""

import argparse
import asyncio
import json
import os
import threading
from pathlib import Path

MAX_SECONDS = 35
TIMEOUT_SECONDS = 60
_slot = threading.BoundedSemaphore(1)


async def transcribe_recording(path: Path) -> str:
    """Keep model imports/memory outside the chat server and kill timed-out work."""
    from .web_server import ApiFailure

    root = Path(__file__).resolve().parents[2]
    python = root / ".tooling/speech/venv/bin/python"
    model = root / ".tooling/speech/model"
    if not python.is_file() or not model.is_dir():
        raise ApiFailure(503, "speech_unavailable", "음성 인식을 준비하지 못했어요.")
    if not _slot.acquire(blocking=False):
        raise ApiFailure(
            503, "speech_busy", "음성 인식 중이에요. 잠시 후 다시 시도해 주세요."
        )
    process = None
    spawning = None
    try:
        environment = dict(os.environ)
        environment.update(
            PYTHONPATH=str(root / "ai"),
            HF_HUB_OFFLINE="1",
            OMP_NUM_THREADS="4",
        )
        spawning = asyncio.create_task(
            asyncio.create_subprocess_exec(
                str(python),
                "-m",
                "kiryu_ai.speech_transcribe",
                "--audio",
                str(path.resolve()),
                "--model",
                str(model),
                env=environment,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
        )
        # Shield process creation so cancellation cannot orphan a newly spawned child.
        process = await asyncio.shield(spawning)
        async with asyncio.timeout(TIMEOUT_SECONDS):
            output, _ = await process.communicate()
        if len(output) > 16_384:
            raise ValueError("Unexpected transcription output")
        result = json.loads(output)
        code = result.get("error")
        if code in {"no_speech", "invalid_audio", "audio_too_long"}:
            messages = {
                "no_speech": "말소리를 듣지 못했어요. 다시 말해 주세요.",
                "invalid_audio": "음성을 읽지 못했어요. 다시 시도해 주세요.",
                "audio_too_long": "한 번에 30초 이내로 말해 주세요.",
            }
            raise ApiFailure(422, code, messages[code])
        text = result.get("text")
        if process.returncode != 0 or not isinstance(text, str) or not text.strip():
            raise ValueError("Invalid transcription result")
        return text.strip()[:1000]
    except TimeoutError:
        raise ApiFailure(
            504, "speech_timeout", "음성 인식이 지연됐어요. 다시 시도해 주세요."
        ) from None
    except (OSError, ValueError, TypeError, AttributeError):
        raise ApiFailure(
            503, "speech_unavailable", "음성 인식을 완료하지 못했어요."
        ) from None
    finally:
        try:
            if process is None and spawning is not None:
                try:
                    process = await spawning
                except OSError:
                    pass  # The safe API error above already describes spawn failure.
            if process is not None and process.returncode is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
                await process.wait()
        finally:
            _slot.release()


def decode_bounded(path: Path):
    """Decode at most 35 seconds, even if the container duration is absent/wrong."""
    import av
    import numpy as np

    chunks = []
    total = 0
    with av.open(str(path)) as container:
        if not container.streams.audio:
            raise ValueError("invalid_audio")
        resampler = av.audio.resampler.AudioResampler(
            format="s16", layout="mono", rate=16000
        )
        for frame in container.decode(audio=0):
            # Reject oversized frames before constructing a resampled numpy buffer.
            if not frame.sample_rate or frame.samples / frame.sample_rate > MAX_SECONDS:
                raise ValueError("audio_too_long")
            for sample in resampler.resample(frame):
                total += sample.samples
                if total > MAX_SECONDS * 16000:
                    raise ValueError("audio_too_long")
                chunks.append(sample.to_ndarray().reshape(-1))
        for sample in resampler.resample(None):
            total += sample.samples
            if total > MAX_SECONDS * 16000:
                raise ValueError("audio_too_long")
            chunks.append(sample.to_ndarray().reshape(-1))
    if not total:
        raise ValueError("no_speech")
    return np.concatenate(chunks).astype(np.float32) / 32768.0


def transcribe(path: Path, model_path: Path) -> str:
    import av
    from faster_whisper import WhisperModel

    try:
        audio = decode_bounded(path)
    except (av.error.FFmpegError, OSError):
        raise ValueError("invalid_audio") from None
    except ValueError:
        raise
    model = WhisperModel(
        str(model_path),
        device="cpu",
        compute_type="int8",
        cpu_threads=4,
        num_workers=1,
        local_files_only=True,
    )
    segments, _ = model.transcribe(
        audio,
        language="ko",
        task="transcribe",
        beam_size=5,
        condition_on_previous_text=False,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        no_speech_threshold=0.6,
        log_prob_threshold=-1.0,
    )
    parts = [
        segment.text.strip()
        for segment in segments
        if segment.no_speech_prob < 0.6
        and segment.avg_logprob >= -1.0
        and segment.compression_ratio <= 2.4
    ]
    text = " ".join(filter(None, parts)).strip()[:1000]
    if not text:
        raise ValueError("no_speech")
    return text


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = {"text": transcribe(args.audio, args.model)}
    except (OSError, ValueError, RuntimeError, ImportError, TypeError) as error:
        code = str(error)
        result = {
            "error": code
            if code in {"no_speech", "audio_too_long", "invalid_audio"}
            else "speech_unavailable"
        }
    # No diagnostic, filename, token or user audio is printed to the server log.
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
