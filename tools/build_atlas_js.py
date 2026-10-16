"""Bundle the atlas JSON into assets/sprites/atlas.js so the game also runs from file://."""
import json
chars = json.load(open('assets/sprites/chars.json'))
world = json.load(open('assets/sprites/world.json'))
open('assets/sprites/atlas.js', 'w').write('window.SPRITES=' + json.dumps({'chars': chars, 'world': world}, separators=(',', ':')) + ';\n')
