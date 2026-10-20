"""Check item consistency, transparency and the CNN's real image inputs."""
import random
import unittest

import numpy as np
from PIL import Image

from backend import cnn
from pixel_items import draw_pixel_item


class SpriteTests(unittest.TestCase):
    def test_every_catalog_item_has_one_consistent_pixel_design(self):
        for _, draw, *_ in [*cnn.ITEM_TYPES, *cnn.NOVEL_TYPES]:
            with self.subTest(item=draw.__name__):
                first = draw_pixel_item(draw.__name__, random.Random(1))
                second = draw_pixel_item(draw.__name__, random.Random(999))
                self.assertIsNotNone(first)
                self.assertEqual((first.mode, first.size), ('RGBA', (32, 32)))
                self.assertEqual(first.tobytes(), second.tobytes())

    def test_pixel_sprites_remain_crisp_rgb_inputs_and_transparent_display_images(self):
        for _, draw, *_ in [*cnn.ITEM_TYPES, *cnn.NOVEL_TYPES]:
            with self.subTest(item=draw.__name__):
                image = cnn.render_item(draw, random.Random(42))
                self.assertEqual((image.mode, image.size), ('RGB', (128, 128)))
                # Every visible pixel occupies a full 4x4 block, without smoothing.
                reduced = image.resize((32, 32), Image.Resampling.NEAREST)
                self.assertEqual(image.tobytes(), reduced.resize(image.size, Image.Resampling.NEAREST).tobytes())
                self.assertEqual(tuple(cnn.to_tensor(image).shape), (3, 64, 64))
                display = cnn.cutout(cnn.sprite(image, 128))
                self.assertEqual(display.mode, 'RGBA')
                self.assertEqual(display.getpixel((0, 0))[3], 0)
                self.assertEqual(set(np.unique(np.asarray(display)[:, :, 3])), {0, 255})

    def test_newspaper_paper_stays_opaque_in_every_pose(self):
        draw = next(draw for name, draw, _ in cnn.ITEM_TYPES if name == 'Newspaper')
        for seed in range(20):
            with self.subTest(seed=seed):
                image = cnn.render_item(draw, random.Random(seed))
                rgb = np.asarray(image)
                background = np.all(rgb == image.info['sprite_background'], axis=2)
                paper = (rgb[:, :, 0] > 200) & (rgb[:, :, 1] > 200) & (rgb[:, :, 2] > 175) & ~background
                self.assertGreater(int(paper.sum()), 1000)
                rgba = np.asarray(cnn.cutout(cnn.sprite(image, 128)))
                self.assertTrue(np.all(rgba[paper, 3] == 255), 'Light paper must never become a transparent black hole.')
                np.testing.assert_array_equal(rgba[paper, :3], rgb[paper])


if __name__ == '__main__':
    unittest.main()
