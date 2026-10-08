#!/usr/bin/env python3
"""
TRASH SORTER - main entry point
===============================
Sort 30 pixel-art items, then watch a convolutional neural network learn your
sorting rules, peek inside it, and test it on items it has never seen.

Files:
  main.py            - this launcher
  config.py          - settings, PICO-8 palette, fonts
  sprites.py         - pixel-art drawing helpers and rendering
  items.py           - the trash catalog (add new items here)
  data.py            - tensors, augmentation, train/val/test split
  model.py           - the CNN, probing helpers and training loop
  network_view.py    - the retro "synaptic view" diagram
  widgets.py         - retro buttons, progress bar, panels, RetroFrame
  gui_app.py         - App: screen switching and the training-thread bridge
  screens/           - title, game, lab (tab host), train_tab, try_tab

Requirements:  pip install torch numpy pillow matplotlib
Optional:      install the free "Press Start 2P" font for full 8-bit text
Run:           python main.py
"""
import matplotlib
matplotlib.use("TkAgg")          # must be set before any matplotlib backend is imported

import tkinter as tk             # noqa: E402

from gui_app import App          # noqa: E402


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
