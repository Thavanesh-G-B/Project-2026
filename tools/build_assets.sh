#!/bin/sh
# Regenerate all sprite atlases from the reference sheets in assets/source (needs Pillow + scipy).
set -e
cd "$(dirname "$0")/.."
python3 -I tools/extract_sprites.py
python3 -I tools/extract_world.py
python3 -I tools/extract_armor.py
python3 -I tools/build_atlas_js.py
python3 tools/extract_hero.py
