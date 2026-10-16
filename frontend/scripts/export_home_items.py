"""Export start-screen pictures from the sorting game's playable catalog.

Run from the repository root with:
.venv312/bin/python -B frontend/scripts/export_home_items.py
"""
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'file_consolidation'))
from items import ITEM_TYPES
from sprites import cutout, render_item

output = ROOT / 'frontend' / 'src' / 'assets' / 'waste' / 'catalog'
output.mkdir(parents=True, exist_ok=True)
imports, entries = [], []
for index, (name, draw, _) in enumerate(ITEM_TYPES):
    filename = name.lower().replace(' ', '-') + '.png'
    cutout(render_item(draw, random.Random(index))).save(output / filename)
    imports.append(f"import item{index} from './{filename}'")
    entries.append(f'  {{ name: {json.dumps(name)}, image: item{index} }},')
(output / 'index.js').write_text(
    '// Generated from file_consolidation/items.py by frontend/scripts/export_home_items.py.\n'
    + '\n'.join(imports) + '\n\nexport default [\n' + '\n'.join(entries) + '\n]\n'
)
