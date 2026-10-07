import subprocess
import base64
import math
import sys
import unittest
from io import BytesIO
from unittest.mock import patch

import torch
from fastapi.testclient import TestClient
from PIL import Image

from backend.main import app, games, get_model
from trash_sorter_cnn import CATEGORIES, TrashCNN


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        get_model.cache_clear()

    def tearDown(self):
        app.dependency_overrides.clear()
        get_model.cache_clear()

    def image(self, mode="RGB"):
        output = BytesIO()
        Image.new(mode, (128, 128)).save(output, format="PNG")
        return output.getvalue()

    def test_import_is_headless(self):
        result = subprocess.run([sys.executable, "-c",
            "import sys, trash_sorter_cnn; assert 'tkinter' not in sys.modules; "
            "assert 'matplotlib' not in sys.modules"], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_health_and_cors(self):
        self.assertEqual(self.client.get("/").json()["categories"], CATEGORIES)
        response = self.client.options("/predict", headers={
            "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
        self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:5173")

    def test_prediction_uses_three_class_cnn(self):
        # Controlled test weights verify preprocessing, inference, and class mapping.
        # These weights are never saved or used by the running app.
        model = TrashCNN().eval()
        with torch.no_grad():
            model.head[-1].weight.zero_()
            model.head[-1].bias.copy_(torch.tensor([0., 2., 0.]))
        with patch("backend.main.get_model", return_value=model):
            for mode in ("RGB", "RGBA", "L"):
                response = self.client.post("/predict", files={"file": ("test.png", self.image(mode), "image/png")})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["predicted_class"], "Compost")
                self.assertAlmostEqual(response.json()["confidence"], 0.786986, places=5)

    def test_missing_checkpoint(self):
        with patch("backend.main.load_model", side_effect=FileNotFoundError):
            response = self.client.post("/predict", files={"file": ("test.png", self.image())})
        self.assertEqual(response.status_code, 503)

    def test_invalid_and_missing_upload(self):
        self.assertEqual(self.client.post("/predict", files={"file": ("bad.png", b"not an image")}).status_code, 400)
        self.assertEqual(self.client.post("/predict").status_code, 422)

    def test_oversized_upload(self):
        response = self.client.post("/predict", files={"file": ("large.png", b"x" * (10 * 1024 * 1024 + 1))})
        self.assertEqual(response.status_code, 413)

    def test_generated_game_and_training(self):
        response = self.client.post('/games')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        game_id = data['game_id']
        try:
            self.assertEqual(data['total'], 30)
            self.assertTrue(data['item']['image'].startswith('data:image/png;base64,'))
            self.assertNotIn('expected', data['item'])
            self.assertEqual(self.client.post(f'/games/{game_id}/train').status_code, 409)
            self.assertEqual(self.client.post(f'/games/{game_id}/sort', json={'index': 0, 'category': 3}).status_code, 422)
            for index in range(30):
                category = games[game_id].items[index]['expected']
                # Deliberately choose another bin for the first item to ensure
                # the player's label is used rather than the common guideline.
                if index == 0:
                    category = (category + 1) % 3
                response = self.client.post(f'/games/{game_id}/sort', json={'index': index, 'category': category})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(games[game_id].items[index]['label'], category)
            self.assertEqual(response.json()['score'], 29)
            self.assertIsNone(response.json()['item'])
            self.assertEqual(self.client.post(f'/games/{game_id}/sort', json={'index': 29, 'category': 0}).status_code, 409)
            with patch('backend.main.threading.Thread') as worker:
                started = self.client.post(f'/games/{game_id}/train')
                self.assertEqual(started.status_code, 200)
                self.assertEqual(started.json()['training']['status'], 'training')
                self.assertEqual(started.json()['training']['history'], [])
                worker.return_value.start.assert_called_once()
                self.assertEqual(self.client.post(f'/games/{game_id}/train').status_code, 409)
            # Real training with a shortened epoch count keeps the test quick.
            with patch('backend.game.EPOCHS', 1):
                games[game_id].train()
            trained = self.client.get(f'/games/{game_id}').json()['training']
            self.assertEqual(trained['status'], 'done', trained)
            self.assertTrue(trained['predictions'])
            self.assertAlmostEqual(trained['before_accuracy'], sum(p['before']['predicted_class'] == p['your_label'] for p in trained['predictions']) / len(trained['predictions']))
            self.assertEqual(sum(trained['split'].values()), 30)
            self.assertEqual(len(trained['history']), 1)
            row = trained['history'][0]
            self.assertEqual(row['epoch'], 1)
            for key in ('train_loss', 'val_loss', 'train_acc', 'val_acc'):
                self.assertTrue(math.isfinite(row[key]))
                self.assertGreaterEqual(row[key], 0)
            self.assertLessEqual(row['train_acc'], 1)
            self.assertLessEqual(row['val_acc'], 1)
            for prediction in trained['predictions']:
                self.assertIn(prediction['predicted_class'], CATEGORIES)
                self.assertGreaterEqual(prediction['confidence'], 0)
                self.assertLessEqual(prediction['confidence'], 1)
                self.assertTrue(prediction['image'].startswith('data:image/png;base64,'))
                self.assertEqual(set(prediction['probabilities']), set(CATEGORIES))
                self.assertAlmostEqual(sum(prediction['probabilities'].values()), 1, places=5)
                self.assertAlmostEqual(prediction['probabilities'][prediction['predicted_class']], prediction['confidence'])
                self.assertEqual(max(prediction['probabilities'], key=prediction['probabilities'].get), prediction['predicted_class'])
                self.assertAlmostEqual(sum(prediction['before']['probabilities'].values()), 1, places=5)
                inspection = prediction['inspection']
                self.assertEqual([layer['shape'] for layer in inspection['layers']], [[16, 32, 32], [32, 16, 16], [64, 8, 8], [64, 4, 4]])
                with Image.open(BytesIO(base64.b64decode(inspection['input_image'].split(',')[1]))) as image:
                    self.assertEqual(image.size, (64, 64))
                    self.assertEqual(list(image.getpixel((32, 32))), inspection['rgb'])
                self.assertEqual(inspection['normalized'], [round(value / 127.5 - 1, 3) for value in inspection['rgb']])
                for layer in inspection['layers']:
                    self.assertEqual(len(layer['maps']), 2)
                    for activation in layer['maps']:
                        with Image.open(BytesIO(base64.b64decode(activation['image'].split(',')[1]))) as image:
                            self.assertEqual(image.size, (layer['shape'][2], layer['shape'][1]))
        finally:
            games.pop(game_id, None)

    def test_missing_game(self):
        self.assertEqual(self.client.get('/games/does-not-exist').status_code, 404)

    def test_quick_demo_uses_prepared_labels(self):
        with patch('backend.main.threading.Thread') as worker:
            response = self.client.post('/demo')
            self.assertEqual(response.status_code, 200)
            demo = response.json()
            try:
                self.assertTrue(demo['demo'])
                self.assertIsNone(demo['item'])
                self.assertEqual(demo['training']['epochs'], 3)
                self.assertEqual(demo['training']['status'], 'training')
                self.assertTrue(all(item['label'] == item['expected'] for item in games[demo['game_id']].items))
                self.assertEqual(worker.call_args.kwargs['args'], (3,))
                worker.return_value.start.assert_called_once()
            finally:
                games.pop(demo['game_id'], None)


if __name__ == "__main__":
    unittest.main()
