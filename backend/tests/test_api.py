import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend.main import JOBS, LabeledImage, TrainRequest, game_items, novel_item, start_training


class GameCatalogTests(unittest.TestCase):
    def test_trick_mode_does_not_send_correct_bins(self):
        response = game_items("trick")
        self.assertEqual(len(response["items"]), 30)
        self.assertTrue(all("expected" not in item for item in response["items"]))

    def test_train_mode_includes_labels_for_feedback(self):
        response = game_items("train")
        self.assertTrue(all(item["expected"] in range(3) for item in response["items"]))
        self.assertTrue(all(item["image"].startswith("data:image/png;base64,") for item in response["items"]))

    def test_invalid_mode_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            game_items("unknown")
        self.assertEqual(raised.exception.status_code, 422)

    def test_familiar_and_novel_samples_are_serializable(self):
        for kind in ("familiar", "novel"):
            with self.subTest(kind=kind):
                result = novel_item(kind)
                self.assertTrue(result["image"].startswith("data:image/png;base64,"))
                self.assertIsInstance(result["name"], str)
                self.assertIn("expected", result)

    @patch("backend.main.train_model")
    def test_training_adapts_web_images_for_model_dataset(self, train_model):
        catalog = game_items("train")["items"][:12]
        request = TrainRequest(items=[
            LabeledImage(image=item["image"], label=index % 3, name=item["name"])
            for index, item in enumerate(catalog)
        ])

        def finish_training(train_images, train_labels, val_set, test_set, **kwargs):
            self.assertTrue(train_images)
            self.assertEqual(len(train_images), len(train_labels))
            self.assertEqual(val_set[0].shape[1:], (3, 64, 64))
            self.assertEqual(test_set[0].shape[1:], (3, 64, 64))
            kwargs["emit"]("done", {"model": object(), "test_acc": 0.0})

        train_model.side_effect = finish_training
        started = start_training(request)
        job = JOBS[started["job_id"]]
        try:
            events = []
            while True:
                kind, payload = job["events"].get(timeout=10)
                events.append(kind)
                if kind == "training_error":
                    self.fail(payload)
                if kind == "done":
                    break
            self.assertIn("dataset", events)
            self.assertEqual(job["status"], "done")
            self.assertIsNotNone(job["model"])
        finally:
            JOBS.pop(started["job_id"], None)


if __name__ == "__main__":
    unittest.main()
