"""Real audio decoder bounds; run in the isolated speech environment."""

import importlib.util
import tempfile
import unittest
import wave
from pathlib import Path

from kiryu_ai.speech_transcribe import decode_bounded


@unittest.skipUnless(
    importlib.util.find_spec("av"), "Speech decoder environment required"
)
class SpeechDecodeTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / "synthetic.wav"

    def wav(self, seconds, channels=1):
        with wave.open(str(self.path), "wb") as output:
            output.setnchannels(channels)
            output.setsampwidth(2)
            output.setframerate(16000)
            output.writeframes(b"\x00\x00" * int(seconds * 16000) * channels)

    def test_stereo_is_mono_and_silence_remains_silent(self):
        self.wav(1, channels=2)
        audio = decode_bounded(self.path)
        self.assertEqual(audio.shape, (16000,))
        self.assertEqual(str(audio.dtype), "float32")
        self.assertFalse(audio.any())

    def test_long_clip_is_rejected_by_decoded_samples(self):
        self.wav(36)
        with self.assertRaisesRegex(ValueError, "audio_too_long"):
            decode_bounded(self.path)

    def test_maximum_duration_is_accepted(self):
        self.wav(35)
        self.assertEqual(len(decode_bounded(self.path)), 35 * 16000)

    def test_empty_container_has_no_usable_speech(self):
        self.wav(0)
        with self.assertRaises((ValueError, OSError)):
            decode_bounded(self.path)


if __name__ == "__main__":
    unittest.main()
