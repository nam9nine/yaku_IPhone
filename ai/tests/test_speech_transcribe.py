"""Process isolation checks. These use no real microphone or speech model."""

import asyncio
import json
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from kiryu_ai import speech_transcribe as speech
from kiryu_ai.web_server import ApiFailure


class SpeechProcessTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.file_patch = patch.object(Path, "is_file", return_value=True)
        self.dir_patch = patch.object(Path, "is_dir", return_value=True)
        self.file_patch.start()
        self.dir_patch.start()
        self.addCleanup(self.file_patch.stop)
        self.addCleanup(self.dir_patch.stop)

    def process(self, value=None):
        process = Mock(returncode=None)
        process.wait = AsyncMock(return_value=0)

        async def communicate():
            process.returncode = 0
            return json.dumps(value or {"text": "인식된 한국어"}).encode(), None

        process.communicate = AsyncMock(side_effect=communicate)
        return process

    async def test_success_is_local_cpu_subprocess_not_model_server(self):
        process = self.process()
        with patch.object(
            asyncio,
            "create_subprocess_exec",
            new_callable=AsyncMock,
            return_value=process,
        ) as spawn:
            self.assertEqual(
                await speech.transcribe_recording(Path("/tmp/audio.m4a")),
                "인식된 한국어",
            )
            args, kwargs = spawn.call_args
            self.assertTrue(args[0].endswith("/.tooling/speech/venv/bin/python"))
            self.assertEqual(args[1:3], ("-m", "kiryu_ai.speech_transcribe"))
            self.assertEqual(kwargs["env"]["HF_HUB_OFFLINE"], "1")
            process.kill.assert_not_called()

    async def test_timeout_kills_and_reaps_before_freeing_slot(self):
        process = self.process()
        process.communicate.side_effect = TimeoutError
        with patch.object(
            asyncio,
            "create_subprocess_exec",
            new_callable=AsyncMock,
            return_value=process,
        ):
            with self.assertRaises(ApiFailure) as error:
                await speech.transcribe_recording(Path("/tmp/audio.m4a"))
            self.assertEqual(error.exception.code, "speech_timeout")
        process.kill.assert_called_once()
        process.wait.assert_awaited_once()
        self.assertTrue(speech._slot.acquire(blocking=False))
        speech._slot.release()

    async def test_cancel_kills_child_and_rejects_concurrent_work(self):
        process = self.process()
        entered = asyncio.Event()

        async def wait_forever():
            entered.set()
            await asyncio.Event().wait()

        process.communicate.side_effect = wait_forever
        with patch.object(
            asyncio,
            "create_subprocess_exec",
            new_callable=AsyncMock,
            return_value=process,
        ) as spawn:
            task = asyncio.create_task(
                speech.transcribe_recording(Path("/tmp/audio.m4a"))
            )
            await entered.wait()
            with self.assertRaises(ApiFailure) as error:
                await speech.transcribe_recording(Path("/tmp/other.webm"))
            self.assertEqual(error.exception.code, "speech_busy")
            self.assertEqual(spawn.call_count, 1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        process.kill.assert_called_once()
        process.wait.assert_awaited_once()
        self.assertTrue(speech._slot.acquire(blocking=False))
        speech._slot.release()

    async def test_spawn_failure_and_no_speech_are_safe_and_release_slot(self):
        with patch.object(
            asyncio,
            "create_subprocess_exec",
            new_callable=AsyncMock,
            side_effect=OSError("private details"),
        ):
            with self.assertRaises(ApiFailure) as error:
                await speech.transcribe_recording(Path("/tmp/audio.m4a"))
            self.assertEqual(error.exception.code, "speech_unavailable")
        process = self.process({"error": "no_speech"})
        with patch.object(
            asyncio,
            "create_subprocess_exec",
            new_callable=AsyncMock,
            return_value=process,
        ):
            with self.assertRaises(ApiFailure) as error:
                await speech.transcribe_recording(Path("/tmp/audio.m4a"))
            self.assertEqual(error.exception.code, "no_speech")


if __name__ == "__main__":
    unittest.main()
