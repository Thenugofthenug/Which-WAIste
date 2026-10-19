"""
GUI application
===============
The App coordinator: holds state shared across screens, switches between
them, and forwards messages from the training thread to the current screen.
The screens themselves live in the screens/ package.
"""
import queue
import threading

from analytics import Stats
from config import ANALYTICS_ENABLED, BG, DEFAULT_LR, NUM_ITEMS
from items import make_game_items
from screens.briefing import BriefingScreen
from screens.game import GameScreen
from screens.lab import LabScreen
from screens.player import PlayerScreen
from screens.title import TitleScreen
from widgets import RetroFonts


class App:
    def __init__(self, root):
        self.root = root
        root.title("TRASH SORTER")
        # fit the window inside the screen (leaving room for the taskbar and title bar);
        # on small screens the larger panels shrink and the bottom buttons stay visible
        screen_w, screen_h = root.winfo_screenwidth(), root.winfo_screenheight()
        width, height = min(1320, screen_w - 40), min(980, screen_h - 90)
        root.geometry(f"{width}x{height}+{max(0, (screen_w - width) // 2)}+0")
        root.configure(bg=BG)
        root.protocol("WM_DELETE_WINDOW", self.on_close)

        # state shared by the screens
        self.fonts = RetroFonts(root)
        self.q = queue.Queue()               # training thread -> GUI
        self.stop_event = threading.Event()  # GUI -> training thread
        self.current_lr = DEFAULT_LR         # survives across games
        self.items = []
        self.player = None                   # (first, last) once entered
        self.stats = Stats()                 # anonymous usage statistics (analytics.py)
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

    def start_from_title(self):
        """START: ask who is playing (once per launch), then begin the game."""
        if ANALYTICS_ENABLED and self.player is None:
            self._switch(PlayerScreen)
        else:
            self.new_game()

    def set_player(self, first, last):
        self.player = (first, last)
        self.stats.set_player(first, last)
        self.new_game()

    def new_game(self):
        """New items, then the mission briefing; the belt starts from there."""
        self.items = make_game_items(NUM_ITEMS)
        self._switch(BriefingScreen)

    def start_sorting(self):
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
        self.stats.close()
        self.root.destroy()
