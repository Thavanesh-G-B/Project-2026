/**
 * Pure profile reducers for Core Drill. StudyOps' App.tsx can call these inside its
 * setProfile callbacks (see INTEGRATION.md); the harness uses them directly.
 */
import { getPlanet, normalizeDrillSave, UPGRADES, upgradeCost } from './balance';
import type { DrillProfile, DrillUpgradeKey, RunResult } from '../types';

/** Deduct the launch cost. Never goes below zero. */
export function launchPlanet<P extends DrillProfile>(p: P, planetId: number, cost: number): P {
  void planetId;
  return { ...p, focusEnergy: Math.max(0, p.focusEnergy - cost) };
}

/** Bank a finished run: currencies, best depth and boss clears. */
export function applyRunResult<P extends DrillProfile>(p: P, r: RunResult): P {
  const drill = normalizeDrillSave(p.drill);
  const prev = drill.bestDepth[r.planetId] ?? 0;
  const planet = getPlanet(r.planetId);
  return {
    ...p,
    techScrap: p.techScrap + Math.max(0, r.scrap),
    neuroCores: p.neuroCores + Math.max(0, r.neuroCores),
    drill: {
      ...drill,
      bestDepth: { ...drill.bestDepth, [r.planetId]: Math.min(planet.depthRows, Math.max(prev, r.depth)) },
      cleared: r.bossBeaten && !drill.cleared.includes(r.planetId) ? [...drill.cleared, r.planetId] : drill.cleared,
    },
  };
}

/** Buy one upgrade level. Re-derives the price so a stale UI cannot underpay. */
export function buyUpgrade<P extends DrillProfile>(p: P, key: DrillUpgradeKey, _claimedCost?: number): P {
  const def = UPGRADES.find((u) => u.key === key);
  if (!def) return p;
  const drill = normalizeDrillSave(p.drill);
  const lvl = drill.upgrades[key];
  const cost = upgradeCost(def, lvl);
  if (lvl >= def.max || p.techScrap < cost) return p;
  return { ...p, techScrap: p.techScrap - cost, drill: { ...drill, upgrades: { ...drill.upgrades, [key]: lvl + 1 } } };
}
