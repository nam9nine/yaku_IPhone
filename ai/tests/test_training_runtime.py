"""Optional CPU-MLX tests; pure boundary tests remain available without MLX."""

import importlib.util
import math
import unittest

from kiryu_ai.masking import EncodedSample

HAS_MLX = importlib.util.find_spec("mlx") is not None


@unittest.skipUnless(HAS_MLX, "MLX is optional for portable CI")
class RuntimeMaskTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import mlx.core as mx

        mx.set_default_device(mx.cpu)

    def test_actual_iterator_masks_variable_length_batch(self):
        from kiryu_ai.training import audit_actual_batches, explicit_batches

        samples = [
            EncodedSample((1, 1, 2, 2, 3, 4), 2, 5, "a"),
            EncodedSample((1, 1, 1, 2, 2, 2, 3, 4), 3, 7, "b"),
        ]
        self.assertEqual(audit_actual_batches(samples, 32), 2)
        batches = list(explicit_batches(samples, 2, 32))
        self.assertEqual(len(batches), 1)
        batch, spans = batches[0]
        self.assertEqual(batch.shape, (2, 32))
        self.assertEqual(spans.tolist(), [[2, 5, 6], [3, 7, 8]])

    def test_loss_gradient_only_reaches_answer_and_eos(self):
        import mlx.core as mx
        from kiryu_ai.training import answer_only_loss

        batch = mx.array([[1, 1, 2, 2, 3, 4, 0, 0]])
        spans = mx.array([[2, 5, 6]])
        logits = mx.zeros((1, 7, 5))

        def loss(values):
            return answer_only_loss(lambda _inputs: values, batch, spans)[0]

        value, gradient = mx.value_and_grad(loss)(logits)
        self.assertAlmostEqual(float(value.item()), math.log(5), places=5)
        active_positions = [
            i for i, row in enumerate(gradient[0].tolist()) if any(v != 0 for v in row)
        ]
        self.assertEqual(active_positions, [1, 2, 3])
        _, count = answer_only_loss(lambda _inputs: logits, batch, spans)
        self.assertEqual(int(count.item()), 3)

    def test_iterator_does_not_truncate(self):
        from kiryu_ai.training import explicit_batches

        sample = EncodedSample((1, 1, 2, 3, 4), 2, 4, "long")
        with self.assertRaisesRegex(ValueError, "truncate"):
            list(explicit_batches([sample], 1, 4))


if __name__ == "__main__":
    unittest.main()
