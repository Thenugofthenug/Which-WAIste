"""Classroom mode changes practice views, preserving labels, splits and the real CNN."""
import random
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import torch

from backend import cnn
from data import make_train_epoch


class ClassroomTests(unittest.TestCase):
    def test_desktop_default_and_classroom_views_keep_each_original_label(self):
        items = cnn.game_items(42)[:3]
        images, labels = [item.image for item in items], [2, 0, 1]
        for count in (None, 4):
            args = () if count is None else (count,)
            images_tensor, label_tensor = make_train_epoch(images, labels, random.Random(7), *args)
            views = count or 8
            self.assertEqual(tuple(images_tensor.shape), (3 * views, 3, 64, 64))
            self.assertEqual(label_tensor.tolist(), [label for label in labels for _ in range(views)])
        for invalid in (0, -1, True, 2.5):
            with self.assertRaises(ValueError):
                make_train_epoch(images, labels, random.Random(7), invalid)

    def test_modes_use_same_labeled_items_and_holdouts_with_real_inference(self):
        items = cnn.game_items(20261020)
        # Include intentionally incorrect labels. Lava items must never acquire fake labels.
        labels = [(item.expected + 1) % 3 for item in items[:18]]
        actions = [SimpleNamespace(outcome='sorted', item_index=i, chosen_class=label)
                   for i, label in enumerate(labels)]
        actions += [SimpleNamespace(outcome='missed', item_index=i, chosen_class=None) for i in range(18, 30)]
        captured = []
        real_train = cnn.train_model

        def train(*args, **kwargs):
            captured.append((args, kwargs))
            return real_train(*args, **kwargs)

        results = []
        for mode in ('classroom', 'full'):
            torch.manual_seed(73)
            with patch('backend.cnn.train_model', side_effect=train):
                result, weights = cnn.run_training(20261020, actions, 1, .001, lambda *_: None, training_mode=mode)
            self.assertEqual(result['training_mode'], mode)
            self.assertEqual(sum(result['split'].values()), 18)
            prediction = cnn.try_item(weights, False)
            self.assertEqual(len(prediction['probabilities']), 3)
            self.assertAlmostEqual(sum(prediction['probabilities']), 1, places=5)
            results.append(result)
        train_indices, _, _ = cnn.stratified_split(labels, random.Random(42))
        self.assertEqual(captured[0][0][1], [labels[index] for index in train_indices])
        self.assertEqual(captured[0][0][1], captured[1][0][1])
        self.assertEqual(captured[0][1]['augmentations_per_item'], 4)
        self.assertEqual(captured[1][1]['augmentations_per_item'], 8)
        for holdout in (2, 3):
            for tensor in (0, 1):
                self.assertTrue(torch.equal(captured[0][0][holdout][tensor], captured[1][0][holdout][tensor]))
            self.assertEqual(captured[0][0][holdout][2], captured[1][0][holdout][2])
        self.assertEqual(results[0]['split'], results[1]['split'])


if __name__ == '__main__':
    unittest.main()
