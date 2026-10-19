"""Mission briefing: the directive players read before the conveyor belt starts."""
import tkinter as tk

from config import ACCENT, CAT_COLORS, CATEGORIES, MUTED, PANEL, PICO
from widgets import RetroFrame


class BriefingScreen(RetroFrame):
    def __init__(self, master, app):
        super().__init__(master, app.fonts)
        self.app = app
        n = len(app.items)
        self.label(self, "MISSION BRIEFING", 30, fg=PICO["green"]).pack(pady=(50, 6))
        player = getattr(app, "player", None)
        if player:
            self.label(self, f"AGENT {player[0]} {player[1]}".upper(), 12, fg=ACCENT).pack()

        outer, body = self.panel(self, "YOUR MISSION")
        outer.pack(pady=(18, 10), padx=40)
        self.label(body, "OUR RECYCLING ROBOT DOESN'T KNOW WHERE TRASH GOES YET - AND YOU'RE GOING TO TEACH IT!\n\n"
                         f"{n} ITEMS WILL RIDE DOWN THE CONVEYOR BELT. PUT EACH ONE IN THE BIN WHERE YOU THINK IT "
                         "BELONGS. EVERY CHOICE YOU MAKE BECOMES A LESSON: AFTER SORTING, THE ROBOT TRAINS ON YOUR "
                         "LABELS, SO SORT CAREFULLY!",
                   12, justify="left", wraplength=1000).pack(anchor="w")

        outer, body = self.panel(self, "HOW TO PLAY")
        outer.pack(pady=10, padx=40)
        bins = tk.Frame(body, bg=PANEL)
        bins.pack(anchor="w", pady=(0, 10))
        for i, (cat, col) in enumerate(zip(CATEGORIES, CAT_COLORS)):
            tk.Label(bins, text=f" {i + 1}  {cat.upper()} ", font=self.fonts(13), bg=col, fg=PICO["black"],
                     relief="raised", bd=4).pack(side="left", padx=(0, 14))
        self.label(body, "  - DRAG AN ITEM INTO A BIN, OR PRESS 1, 2 OR 3 TO SORT THE ITEM IN THE YELLOW BOX.\n"
                         "  - ITEMS THAT REACH THE END OF THE BELT FALL INTO THE LAVA AND ARE LOST FROM YOUR "
                         "DATASET.\n"
                         "  - IF YOU MISS ONE, THE BELT PAUSES AND YOU CAN SLOW IT DOWN.\n"
                         "  - +10 POINTS FOR EACH ITEM IN THE BIN MOST RECYCLING PROGRAMS USE.\n"
                         "  - STUCK? PRESS ? LEARNING TIPS AT ANY TIME - THE BELT WAITS FOR YOU.",
                   11, justify="left", wraplength=1000).pack(anchor="w")

        start = self.button(self, "START SORTING >", app.start_sorting, 16, bg=PICO["green"])
        start.pack(pady=(24, 6))
        start.focus_set()                    # Enter or Space also starts
        self.label(self, "THE BELT STARTS MOVING AS SOON AS YOU PRESS START.", 9, fg=MUTED).pack()
