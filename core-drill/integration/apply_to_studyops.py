#!/usr/bin/env python3
"""
Install Core Drill into a StudyOps checkout.

    python3 integration/apply_to_studyops.py /path/to/studyops

Copies the game into <studyops>/src/core-drill/ and patches four existing files
(types, Header nav, App state/handlers, view routing). Every edit anchors on text
that must exist exactly once; if the app has drifted the script stops with a
message instead of guessing. Re-running on an already patched tree is a no-op.
"""
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent


def edit(path: Path, pairs, marker: str):
    text = path.read_text()
    if marker in text:
        print(f"  = {path.name}: already patched")
        return
    for old, new in pairs:
        if text.count(old) != 1:
            sys.exit(f"anchor not found exactly once in {path}:\n---\n{old}\n---")
        text = text.replace(old, new)
    path.write_text(text)
    print(f"  + {path.name}")


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    root = Path(sys.argv[1]).resolve()
    src = root / "src"
    if not (src / "App.tsx").exists():
        sys.exit(f"{root} does not look like StudyOps (no src/App.tsx)")

    dest = src / "core-drill"
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir()
    for sub in ("game", "components", "space", "assets", "ui"):
        shutil.copytree(HERE / "src" / sub, dest / sub)
    shutil.copy(HERE / "src" / "types.ts", dest / "types.ts")
    (dest / "assets.d.ts").write_text("declare module '*.png' {\n  const src: string;\n  export default src;\n}\n")
    print(f"  + copied game to {dest.relative_to(root)}")

    edit(src / "types" / "index.ts", [
        ("  upgrades: ArmoryUpgrades;\n}", "  upgrades: ArmoryUpgrades;\n  drill?: import('../core-drill/types').DrillSave; // Core Drill progress\n}"),
        ("  | 'game'\n", "  | 'game'\n  | 'core-drill'\n"),
    ], "core-drill")

    edit(src / "components" / "Header.tsx", [
        ("  LayoutDashboard,\n} from 'lucide-react';", "  LayoutDashboard,\n  Pickaxe,\n} from 'lucide-react';"),
        ("    { id: 'flashcards', label: 'Drills',",
         "    { id: 'core-drill', label: 'Core Drill', icon: <Pickaxe className=\"w-4 h-4\" /> },\n    { id: 'flashcards', label: 'Drills',"),
    ], "core-drill")

    edit(src / "App.tsx", [
        ("import { ArmoryModal } from './components/ArmoryModal';",
         "import { ArmoryModal } from './components/ArmoryModal';\n"
         "import CoreDrillGame from './core-drill/components/CoreDrillGame';\n"
         "import { applyRunResult, applySortieResult, buyUpgrade, launchPlanet, markPlanetCleared } from './core-drill/game/progress';\n"
         "import { getPlanet } from './core-drill/game/balance';\n"
         "import type { RunResult } from './core-drill/types';\n"
         "import type { SortieResult } from './core-drill/space/engine';"),
        ("params.get('view') === 'game') {\n        return 'game';\n      }",
         "params.get('view') === 'game') {\n        return 'game';\n      }\n      if (params.get('view') === 'core-drill') return 'core-drill';"),
        ("  // Handle In-Combat Zombie Kill",
         """  // ---- Core Drill ----
  const handleDrillLaunch = (planetId: number, cost: number) =>
    setProfile((prev) => launchPlanet(prev, planetId, cost));

  const handleDrillComplete = (result: RunResult) => {
    setProfile((prev) => applyRunResult(prev, result));
    const progress = Math.max(1, Math.round(result.depth / 10)) + result.bossesDown * 5;
    setDailyMissions((prev) => {
      const { updatedMissions, newlyCompleted } = updateMissionProgress(prev, 'game', progress);
      if (newlyCompleted.length > 0) {
        showToast(`Daily Mission Completed: ${newlyCompleted[0].title}! Claim in Command HQ.`);
      }
      return updatedMissions;
    });
    setSquad((prev) => ({
      ...prev,
      members: prev.members.map((m) =>
        m.id === 'player' ? { ...m, defenseContribution: m.defenseContribution + result.scrap } : m
      ),
      activityFeed: [
        {
          id: `act_${Date.now()}`,
          memberId: 'player',
          memberName: 'Alex (You)',
          action: result.clears.length > 0
            ? `cleared ${result.clears.map((id) => getPlanet(id).name).join(' + ')} (${result.bossesDown} boss${result.bossesDown === 1 ? '' : 'es'} down)`
            : `drilled to ${result.depth}m on ${getPlanet(result.planetId).name}`,
          rewardDesc: `+${result.scrap} Scrap · +${result.neuroCores} Neuro-Cores`,
          timestamp: 'Just now',
        },
        ...prev.activityFeed.slice(0, 5),
      ],
    }));
    showToast(`Core Drill: +${result.scrap} Scrap · +${result.neuroCores} Cores banked`);
  };

  const handleSortieComplete = (result: SortieResult) => {
    setProfile((prev) => applySortieResult(prev, result));
    setDailyMissions((prev) => updateMissionProgress(prev, 'game', Math.max(1, result.wave) + result.bossesDown * 5).updatedMissions);
    setSquad((prev) => ({
      ...prev,
      members: prev.members.map((m) =>
        m.id === 'player' ? { ...m, defenseContribution: m.defenseContribution + result.scrap } : m
      ),
      activityFeed: [
        {
          id: `act_${Date.now()}`,
          memberId: 'player',
          memberName: 'Alex (You)',
          action: `flew an orbital patrol over ${getPlanet(result.planetId).name}: wave ${result.wave}${result.bossesDown ? `, ${result.bossesDown} boss down` : ''}`,
          rewardDesc: `+${result.scrap} Scrap · +${result.neuroCores} Neuro-Cores`,
          timestamp: 'Just now',
        },
        ...prev.activityFeed.slice(0, 5),
      ],
    }));
    showToast(`Orbital patrol: +${result.scrap} Scrap · +${result.neuroCores} Cores banked`);
  };

  const handleDrillRecall = () => {
    setDailyMissions((prev) => updateMissionProgress(prev, 'flashcards', 1).updatedMissions);
  };

  // Handle In-Combat Zombie Kill"""),
        ("        {currentView === 'flashcards' && (",
         """        {currentView === 'core-drill' && (
          <CoreDrillGame
            profile={profile}
            augments={augments}
            flashcards={flashcards}
            onLaunch={handleDrillLaunch}
            onRunComplete={handleDrillComplete}
            onPlanetCleared={(id) => setProfile((prev) => markPlanetCleared(prev, id))}
            onSortieComplete={handleSortieComplete}
            onBuyUpgrade={(key, cost) => setProfile((prev) => buyUpgrade(prev, key, cost))}
            onOverrideSuccess={handleDrillRecall}
            onVaultSolved={handleDrillRecall}
            onNavigateToFocus={() => setCurrentView('focus')}
          />
        )}

        {currentView === 'flashcards' && ("""),
    ], "CoreDrillGame")
    edit(root / "index.html", [
        ("</head>", '    <link href="https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&display=swap" rel="stylesheet" />\n  </head>'),
    ], "Silkscreen")
    print("done. Run `npm run lint && npm run build` in the StudyOps checkout.")


main()
