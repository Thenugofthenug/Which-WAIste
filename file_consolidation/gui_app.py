"""
GUI application
===============
The App coordinator: holds state shared across screens, switches between
them, and forwards messages from the training thread to the current screen.
The screens themselves live in the screens/ package.
"""
import queue
import threading

from config import BG, DEFAULT_LR, NUM_ITEMS
from items import make_game_items
from screens.game import GameScreen
from screens.lab import LabScreen
from screens.title import TitleScreen
from widgets import RetroFonts


class App:
    def __init__(self, root):
        self.root = root
        root.title("TRASH SORTER")
        root.geometry("1320x980")
        root.configure(bg=BG)
        root.protocol("WM_DELETE_WINDOW", self.on_close)

        # state shared by the screens
        self.fonts = RetroFonts(root)
        self.q = queue.Queue()               # training thread -> GUI
        self.stop_event = threading.Event()  # GUI -> training thread
        self.current_lr = DEFAULT_LR         # survives across games
        self.items = []
        self.screen = None

        self.show_title()
        self.root.after(100, self.poll_queue)

    # ------------------------------------------------------------ navigation
    def _switch(self, screen_cls):
        if self.screen is not None:
            self.screen.destroy()
        while not self.q.empty():            # drop messages meant for the old screen
            self.q.get_nowait()
        self.screen = screen_cls(self.root, self)
        self.screen.pack(fill="both", expand=True)

    def show_title(self):
        self._switch(TitleScreen)

    def new_game(self):
        self.items = make_game_items(NUM_ITEMS)
        self._switch(GameScreen)

    def show_lab(self):
        self._switch(LabScreen)

    # --------------------------------------------------------- thread bridge
    def poll_queue(self):
        handler = getattr(self.screen, "handle_message", None)
        try:
            while True:
                kind, data = self.q.get_nowait()
                if handler is not None:
                    handler(kind, data)
        except queue.Empty:
            pass
        self.root.after(100, self.poll_queue)

    def on_close(self):
        self.stop_event.set()
        self.root.destroy()
