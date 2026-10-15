"""Optional, plain-language help shared by the retro game and learning lab."""
import tkinter as tk

from config import ACCENT, BG, FG, MUTED, PANEL, PICO
from widgets import RetroFrame


TOPICS = {
    "Labels teach the robot": (
        "A label is the bin you choose for an image. The CNN learns from those choices, "
        "including incorrect ones. The points compare your choice with a common sorting guideline; "
        "local recycling rules can vary.\n\n"
        "Missed items disappear into the game lava without receiving a label. They stay out of "
        "training, validation and testing. The lava is a game effect, not a real waste-disposal method.\n\n"
        "Try this: could the robot learn a misleading rule if several examples had the wrong label?"
    ),
    "Pixels become numbers": (
        "The robot receives a 64 by 64 image, not the item's name. Each pixel contains red, "
        "green and blue values. We scale those values from 0–255 to −1–1 before the CNN uses them.\n\n"
        "It must learn from patterns in these numbers. It does not know what a banana is in the way you do."
    ),
    "Filters and patterns": (
        "A filter is a small learned pattern detector that moves across an image. Its responses "
        "form a feature map: a grid showing where it responded strongly. Later layers combine earlier responses.\n\n"
        "ReLU keeps positive responses. Pooling shrinks the grids. Our CNN has four blocks, "
        "with 16, 32, 64 and 64 channels.\n\n"
        "The lab diagram summarizes the most active channels. It is not a complete feature map "
        "or proof that the robot understands a human concept like 'metal.'"
    ),
    "Weights change decisions": (
        "A weight is a learned number controlling how much a response contributes to the next layer. "
        "Training adjusts weights to reduce errors against your labels.\n\n"
        "In a tiny example, response 0.8 × weight 2 gives a contribution of 1.6. A negative weight "
        "can lower a score, and a zero response contributes nothing. The real network combines many responses.\n\n"
        "Green and red lines in the diagram summarize positive and negative connections; "
        "they are not literal conveyor sensors."
    ),
    "Epoch, loss and learning rate": (
        "An epoch is one pass through the training examples. Loss measures how wrong the predictions "
        "are compared with the labels. Training tries to reduce it.\n\n"
        "Learning rate controls the size of weight updates. A very large rate can make learning unstable; "
        "a tiny rate may learn slowly.\n\n"
        "Try this: watch the training and validation curves. Do they always improve together?"
    ),
    "Practice versus a fair test": (
        "Training examples update weights. Validation examples help choose the best model without "
        "updating its weights. Test examples are kept aside for the final check.\n\n"
        "We split original items before making augmented views, so copies of one item do not leak "
        "between sets. The before/after comparison uses the same held-out test views.\n\n"
        "If training accuracy improves while validation gets worse, the model may be memorizing "
        "practice examples. This is called overfitting."
    ),
    "Points are not accuracy": (
        "Game score: +10 for a correct sort, +0 for a wrong or missed item. A mistake or miss resets "
        "your streak. Sorting all items correctly wins the sorting mission.\n\n"
        "Model accuracy: the fraction of test predictions matching the supplied labels. "
        "This measures something different from your points.\n\n"
        "Good labels and enough varied examples can help learning, but higher accuracy is not "
        "guaranteed. A tiny test set can give a noisy result."
    ),
    "A high score can be wrong": (
        "Softmax turns the model's three final values into scores adding up to 100%. "
        "The highest score selects the bin.\n\n"
        "An 80% score is not a promise that the answer is correct. The model always chooses "
        "among its three bins; it has no 'I don't know' option. Compare its choice with a reliable label."
    ),
    "Try something it has not seen": (
        "Use TRY NEW ITEMS after training. A new drawing of a familiar item tests whether the model "
        "can handle variations. A never-seen type tests a bigger change.\n\n"
        "Some items need a destination outside our three bins. The CNN will still choose one of "
        "its bins, even if none is suitable. More confidence does not fix a missing category."
    ),
}


class LearningGuide(tk.Toplevel):
    def __init__(self, owner, on_close=None):
        super().__init__(owner)
        self.title("ROBOT FIELD GUIDE")
        self.geometry("900x530")
        self.minsize(720, 420)
        self.configure(bg=BG)
        self.transient(owner.winfo_toplevel())
        self.on_close = on_close
        self.protocol("WM_DELETE_WINDOW", self.close)
        frame = RetroFrame(self, owner.fonts)
        frame.pack(fill="both", expand=True, padx=12, pady=12)
        frame.label(frame, "ROBOT FIELD GUIDE", 18, fg=ACCENT).pack(anchor="w", pady=(0, 8))
        frame.label(frame, "CHOOSE A TOPIC. DURING SORTING, THE BELT PAUSES WHILE YOU READ.",
                    9, fg=MUTED).pack(anchor="w", pady=(0, 12))
        body = tk.Frame(frame, bg=BG)
        body.pack(fill="both", expand=True)
        self.topics = tk.Listbox(body, width=32, bg=PANEL, fg=FG, selectbackground=PICO['dark_green'],
                                selectforeground=FG, font=owner.fonts(10), exportselection=False,
                                activestyle='none', height=len(TOPICS))
        self.topics.pack(side="left", fill="y", padx=(0, 12))
        for topic in TOPICS:
            self.topics.insert("end", topic)
        content = tk.Frame(body, bg=BG)
        content.pack(side="left", fill="both", expand=True)
        self.text = tk.Text(content, bg=PANEL, fg=FG, font=owner.fonts(12), wrap="word",
                            padx=16, pady=16, relief="flat", width=1)
        scrollbar = tk.Scrollbar(content, command=self.text.yview)
        self.text.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.text.pack(fill="both", expand=True)
        self.topics.bind('<<ListboxSelect>>', self.show_topic)
        self.topics.selection_set(0)
        self.show_topic()
        frame.button(frame, "CLOSE GUIDE", self.close, 11, bg=PICO['green']).pack(pady=(12, 0))

    def show_topic(self, _event=None):
        selection = self.topics.curselection()
        if not selection:
            return
        title = list(TOPICS)[selection[0]]
        self.text.configure(state="normal")
        self.text.delete('1.0', 'end')
        self.text.insert('end', title.upper() + '\n\n' + TOPICS[title])
        self.text.configure(state="disabled")
        self.text.yview_moveto(0)

    def close(self):
        self.destroy()
        if self.on_close:
            self.on_close()


def add_tooltip(widget, text, fonts):
    """Show compact help on hover or keyboard focus; keep it out of the layout."""
    widget.configure(takefocus=True)
    popup = None
    timer = None

    def hide(_event=None):
        nonlocal popup, timer
        if timer:
            widget.after_cancel(timer)
            timer = None
        if popup:
            popup.destroy()
            popup = None

    def show():
        nonlocal popup, timer
        timer = None
        popup = tk.Toplevel(widget)
        popup.overrideredirect(True)
        popup.geometry(f"+{widget.winfo_rootx()}+{widget.winfo_rooty() + widget.winfo_height() + 4}")
        tk.Label(popup, text=text, bg=PANEL, fg=FG, font=fonts(10), wraplength=340,
                 justify='left', padx=10, pady=8, relief='solid', bd=2).pack()

    def schedule(_event=None):
        nonlocal timer
        hide()
        timer = widget.after(500, show)

    for event in ('<Enter>', '<FocusIn>'):
        widget.bind(event, schedule, add='+')
    for event in ('<Leave>', '<FocusOut>', '<ButtonPress>', '<Destroy>'):
        widget.bind(event, hide, add='+')
