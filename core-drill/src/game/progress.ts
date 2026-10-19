/**
 * Pure profile reducers for Core Drill. StudyOps' App.tsx can call these inside its
 * setProfile callbacks (see INTEGRATION.md); the harness uses them directly.
 */
import { normalizeDrillSave, UPGRADES, upgradeCost } from './balance';
import type { SortieResult } from '../space/engine';
import type { DrillProfile, DrillUpgradeKey, RunResult } from '../types';

/** Deduct the launch cost. Never goes below zero. */
export function launchPlanet<P extends DrillProfile>(p: P, planetId: number, cost: number): P {
  void planetId;
  return { ...p, focusEnergy: Math.max(0, p.focusEnergy - cost) };
}

/** Record a planet's core boss as beaten the moment it happens, so a closed tab cannot lose the unlock. */
export function markPlanetCleared<P extends DrillProfile>(p: P, planetId: number): P {
  const drill = normalizeDrillSave(p.drill);
  if (drill.cleared.includes(planetId)) return p;
  return { ...p, drill: { ...drill, cleared: [...drill.cleared, planetId] } };
}

/** Bank a finished run: currencies, best depth per planet visited, and boss clears. */
export function applyRunResult<P extends DrillProfile>(p: P, r: RunResult): P {
  const drill = normalizeDrillSave(p.drill);
  const bestDepth = { ...drill.bestDepth };
  const depths = Object.keys(r.depths).length ? r.depths : { [r.planetId]: r.depth };
  for (const [id, d] of Object.entries(depths)) {
    bestDepth[Number(id)] = Math.max(bestDepth[Number(id)] ?? 0, Math.max(0, Math.floor(d)));
  }
  const cleared = [...drill.cleared];
  for (const id of r.clears ?? []) if (!cleared.includes(id)) cleared.push(id);
  return {
    ...p,
    techScrap: p.techScrap + Math.max(0, r.scrap),
    neuroCores: p.neuroCores + Math.max(0, r.neuroCores),
    drill: { ...drill, bestDepth, cleared },
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

/** Bank a finished orbital patrol: currencies and the best wave per planet. */
export function applySortieResult<P extends DrillProfile>(p: P, r: SortieResult): P {
  const drill = normalizeDrillSave(p.drill);
  const bestWave = { ...(drill.bestWave ?? {}) };
  bestWave[r.planetId] = Math.max(bestWave[r.planetId] ?? 0, Math.max(0, Math.floor(r.wave)));
  return {
    ...p,
    techScrap: p.techScrap + Math.max(0, r.scrap),
    neuroCores: p.neuroCores + Math.max(0, r.neuroCores),
    drill: { ...drill, bestWave },
  };
}
