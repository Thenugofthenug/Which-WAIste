"""Exercise the actual Tk conveyor and CNN, with the test window hidden."""
import random
import sys
import threading
import tkinter as tk
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import torch
from config import DEFAULT_LR
from data import build_eval_set, stratified_split
from gui_app import App
from items import make_game_items
from model import train_model
from screens.game import GameScreen, SPEED, SPEEDS, STOP_Y
from screens.lab import LabScreen
from widgets import RetroFonts


class ConveyorTests(unittest.TestCase):
    def setUp(self):
        self.root = tk.Tk()
        self.root.withdraw()
        self.app = SimpleNamespace(items=make_game_items(30, random.Random(4)),
                                   fonts=RetroFonts(self.root), show_lab=lambda: None,
                                   new_game=lambda: None, current_lr=0.001)
        self.game = GameScreen(self.root, self.app)

    def tearDown(self):
        self.game.destroy()
        self.root.destroy()

    def test_scores_and_streak_reset_but_wrong_label_is_preserved(self):
        for _ in range(3):
            self.game._spawn()
        first, second, third = self.game.belt[:]
        self.game._sort(first, self.app.items[first.index].expected)
        self.game._sort(second, self.app.items[second.index].expected)
        self.assertEqual((self.game.score, self.game.streak), (20, 2))
        wrong = (self.app.items[third.index].expected + 1) % 3
        self.game._sort(third, wrong)
        self.assertEqual((self.game.score, self.game.streak, self.game.best_streak), (20, 0, 2))
        self.assertEqual(self.app.items[third.index].label, wrong)

    def test_trick_mode_hides_sorting_correctness(self):
        self.game.trick_mode = True
        self.game._spawn()
        first = self.game.belt[0]
        wrong = (self.app.items[first.index].expected + 1) % 3
        self.game._sort(first, wrong)
        wrong_feedback = (self.game.c.itemcget(self.game.fb_text, "text"),
                          self.game.c.itemcget(self.game.fb_sub, "text"))
        self.assertEqual(wrong_feedback, (
            "ITEM SORTED", "YOUR LABEL WAS SAVED AS A ROBOT PRACTICE EXAMPLE."))
        self.assertNotIn("RIGHT", self.game.count_lbl.cget("text"))
        self.assertNotIn("SCORE", self.game.count_lbl.cget("text"))

        self.game._spawn()
        second = self.game.belt[0]
        self.game._sort(second, self.app.items[second.index].expected)
        correct_feedback = (self.game.c.itemcget(self.game.fb_text, "text"),
                            self.game.c.itemcget(self.game.fb_sub, "text"))
        self.assertEqual(correct_feedback, wrong_feedback)

        self.app.trick_mode = True
        self.app.game_summary = "SCORE 10 | RIGHT 1 | WRONG 0"
        lab = LabScreen(self.root, self.app)
        summaries = [child.cget("text") for child in lab.winfo_children()
                     if isinstance(child, tk.Label)]
        self.assertIn("TRICK MODE: SORTING FEEDBACK HIDDEN.", summaries)
        self.assertNotIn(self.app.game_summary, summaries)
        lab.destroy()

    def test_bin_count_table_updates_for_each_selected_category(self):
        self.assertEqual([self.game.c.itemcget(label, "text")
                          for label in self.game.bin_count_lbls], ["0", "0", "0"])
        for category in (0, 1, 1, 2):
            self.game._spawn()
            self.game._sort(self.game.belt[0], category)
        self.assertEqual([self.game.c.itemcget(label, "text")
                          for label in self.game.bin_count_lbls], ["1", "2", "1"])

    def test_missed_drag_is_cleared_and_belt_continues(self):
        self.game._spawn()
        item = self.game.belt[0]
        item.y = STOP_Y
        item.dragging = True
        self.game.drag = (item, 0, 0)
        roll = self.game.roll
        self.game._tick()
        self.assertIsNone(self.game.drag)
        self.assertIsNone(self.app.items[0].label)
        self.assertEqual(self.game.missed, 1)
        self.assertNotEqual(self.game.roll, roll)
        self.assertEqual(self.game.next_spawn, 2)

    def test_speed_choices_and_lava_cleanup(self):
        self.assertGreater(SPEED, 2.2)
        self.assertEqual(len(self.game.c.find_withtag('lava')), 36)
        self.game._spawn()
        item = self.game.belt[0]
        start = item.y
        self.game._set_speed('HIGH')
        self.game._tick()
        self.assertAlmostEqual(item.y - start, SPEEDS['HIGH'])
        self.game._miss(item)
        self.assertEqual(self.game.c.type(item.image_id), 'image')
        self.assertEqual(len(self.game.c.find_withtag('lava-spark')), 8)
        self.root.after(450, self.root.quit)
        self.root.mainloop()
        self.assertIsNone(self.game.c.type(item.image_id))
        self.assertEqual(len(self.game.c.find_withtag('lava-spark')), 0)
        self.assertEqual(self.game.missed, 1)

    def test_speed_buttons_select_low_medium_and_high(self):
        self.assertEqual(set(self.game.speed_buttons), {"LOW", "MEDIUM", "HIGH"})
        self.assertEqual(self.game.speed.get(), "MEDIUM")
        for level in ("LOW", "MEDIUM", "HIGH"):
            self.game.speed_buttons[level]._command()
            self.assertEqual(self.game.speed.get(), level)

    def test_guide_pauses_belt_and_resumes_without_changing_labels(self):
        self.game._spawn()
        item = self.game.belt[0]
        start = item.y
        self.game.open_guide()
        self.game.guide.withdraw()
        self.game._tick()
        self.assertEqual(item.y, start)
        guide = self.game.guide
        self.assertIn('LABELS TEACH THE ROBOT', guide.text.get('1.0', 'end'))
        guide.topics.selection_clear(0, 'end')
        guide.topics.selection_set(2)
        guide.show_topic()
        self.assertIn('feature map', guide.text.get('1.0', 'end'))
        guide.close()
        self.assertFalse(self.game.paused)
        self.game._tick()
        self.assertGreater(item.y, start)
        self.assertIsNone(self.app.items[0].label)

    def test_all_missed_round_finishes_and_lab_offers_replay(self):
        for _ in self.app.items:
            self.game._spawn()
            self.game._miss(self.game.belt[0])
        self.assertTrue(self.game.done)
        self.assertEqual(self.game.missed, 30)
        lab = LabScreen(self.root, self.app)
        self.assertEqual(lab.items, [])
        self.assertEqual(lab.tabs, {})
        lab.destroy()

    def test_perfect_round_earns_300_and_displays_win(self):
        for item in self.app.items:
            self.game._spawn()
            self.game._sort(self.game.belt[0], item.expected)
        self.assertTrue(self.game.done)
        self.assertEqual((self.game.score, self.game.best_streak), (300, 30))
        self.game._show_summary()
        self.assertEqual(self.game.c.itemcget(self.game.fb_text, 'text'), 'PERFECT SORTING!')
        self.assertEqual(self.game.c.coords(self.game.summary_window), [640.0, 422.0])
        buttons = self.game.summary_controls.winfo_children()
        self.assertEqual([button.cget("text") for button in buttons],
                         ["TEACH THE ROBOT >", "PLAY AGAIN"])
        self.assertTrue(all(button.pack_info()["side"] == "top" for button in buttons))

    def test_partial_round_lab_uses_only_labeled_items(self):
        for i, item in enumerate(self.app.items):
            self.game._spawn()
            if i < 18:
                self.game._sort(self.game.belt[0], item.expected)
            else:
                self.game._miss(self.game.belt[0])
        self.assertTrue(self.game.done)
        lab = LabScreen(self.root, self.app)
        self.assertEqual(len(lab.items), 18)
        self.assertTrue(all(item.label is not None for item in lab.items))
        tab = lab.tabs['train']
        for _ in range(25):
            tab.change_probe(1)
        self.assertLess(tab.probe_idx, 18)
        self.root.update_idletasks()  # Complete matplotlib's queued draws before destroying its widgets.
        lab.destroy()


class AppStateTests(unittest.TestCase):
    def test_home_resets_run_state_and_stops_previous_training(self):
        old_stop_event = threading.Event()
        app = SimpleNamespace(
            stop_event=old_stop_event,
            current_lr=0.02,
            items=[object()],
            trick_mode=True,
            game_summary="SCORE 10",
            show_title=lambda: setattr(app, "returned_home", True),
        )
        App.home(app)
        self.assertTrue(old_stop_event.is_set())
        self.assertIsNot(app.stop_event, old_stop_event)
        self.assertFalse(app.stop_event.is_set())
        self.assertEqual(app.current_lr, DEFAULT_LR)
        self.assertEqual(app.items, [])
        self.assertFalse(app.trick_mode)
        self.assertEqual(app.game_summary, "")
        self.assertTrue(app.returned_home)


class TrainingTests(unittest.TestCase):
    def test_real_training_reports_before_and_after_on_held_out_views(self):
        torch.set_num_threads(2)
        items = make_game_items(18, random.Random(4))
        for item in items:
            item.label = item.expected
        train, val, test = stratified_split([item.label for item in items], random.Random(42))
        rng = random.Random(7)
        val_set = build_eval_set(items, val, rng)
        test_set = build_eval_set(items, test, rng)
        events = []
        with patch('model.EPOCHS', 1):
            train_model([items[i].image for i in train], [items[i].label for i in train],
                        val_set, test_set, lambda: 0.001, lambda: (val[0], items[val[0]].image),
                        threading.Event(), lambda kind, data: events.append((kind, data)))
        result = events[-1][1]
        self.assertEqual(events[-1][0], 'done')
        self.assertTrue(0 <= result['before_test_acc'] <= 1)
        self.assertTrue(0 <= result['test_acc'] <= 1)
        self.assertEqual(set(result['item_probs']), set(test))


if __name__ == '__main__':
    unittest.main()
