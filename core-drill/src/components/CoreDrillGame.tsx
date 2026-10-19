import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cargoCount, cargoValue, coreDepth, getPlanet, isPlanetUnlocked, MERCHANT_OFFERS, nextPlanet, normalizeDrillSave,
  PLANETS, PlanetDef, resolveRigStats, TILE, UPGRADES, upgradeCost,
} from '../game/balance';
import { DrillEngine, EngineEvent, Input } from '../game/engine';
import { Camera, render } from '../game/render';
import { isMuted, music, setMuted, sfx } from '../game/sfx';
import type { DrillProfile, DrillUpgradeKey, Flashcard, RunResult, SubjectCombatAugment } from '../types';
import './core-drill.css';

export interface CoreDrillGameProps {
  profile: DrillProfile;
  augments: SubjectCombatAugment[];
  flashcards: Flashcard[];
  /** Called when a run starts; the host should deduct `cost` Focus Energy. */
  onLaunch: (planetId: number, cost: number) => void;
  /** Called once when a run ends; the host banks scrap/cores and updates drill progress + missions. */
  onRunComplete: (result: RunResult) => void;
  /** Called the moment a planet's core boss dies, so the unlock is saved even if the tab closes. */
  onPlanetCleared?: (planetId: number) => void;
  /** Host deducts `cost` Tech Scrap and raises the upgrade level. */
  onBuyUpgrade: (key: DrillUpgradeKey, cost: number) => void;
  onOverrideSuccess?: () => void;
  onVaultSolved?: () => void;
  onNavigateToFocus?: () => void;
}

type Phase = 'orbit' | 'playing' | 'result';

interface Hud {
  hull: number; maxHull: number; shield: number; maxShield: number;
  fuel: number; maxFuel: number; energy: number; maxEnergy: number;
  cargo: number; cargoCap: number; cargoValue: number; bombs: number;
  depth: number; banked: number; overrideCd: number; recall: number;
  boss: { hp: number; max: number; name: string } | null;
  onPad: boolean; kills: number; planetId: number; surge: number;
  nearMerchant: boolean; slow: boolean; burn: boolean;
}

interface CardModal { mode: 'vault' | 'override'; card: Flashcard; input: string; revealed: boolean }

const FALLBACK_CARDS: Flashcard[] = [
  { id: 'fb1', subject: 'math', deck: 'Emergency Core Diagnostic', question: 'Solve for x: 3x - 7 = 14', answer: 'x = 7', hint: 'Add 7 to both sides, then divide by 3', mastered: false },
  { id: 'fb2', subject: 'science', deck: 'Physics Energy Matrix', question: 'Kinetic energy for mass m and velocity v?', answer: 'KE = ½ m v²', hint: 'Half mass times velocity squared', mastered: false },
  { id: 'fb3', subject: 'cs', deck: 'Algorithms', question: 'Average time complexity of binary search?', answer: 'O(log n)', hint: 'The search space halves each step', mastered: false },
];

const SUBJECT_COLORS: Record<string, string> = {
  math: '#22d3ee', science: '#34d399', cs: '#a78bfa', humanities: '#fbbf24', languages: '#f472b6', arts: '#fb7185',
};

const pct = (v: number, max: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;

export default function CoreDrillGame(props: CoreDrillGameProps) {
  const { profile, augments, onLaunch, onBuyUpgrade, onNavigateToFocus } = props;
  const [phase, setPhase] = useState<Phase>('orbit');
  const [planetId, setPlanetId] = useState(1);
  const [result, setResult] = useState<RunResult | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [banner, setBanner] = useState<{ text: string; color: string } | null>(null);
  const [modal, setModal] = useState<CardModal | null>(null);
  const [choice, setChoice] = useState<{ planetId: number } | null>(null);
  const [trader, setTrader] = useState(false);
  const [traderBank, setTraderBank] = useState(0);
  const [muted, setMutedState] = useState(isMuted());

  const save = useMemo(() => normalizeDrillSave(profile.drill), [profile.drill]);
  const stats = useMemo(() => resolveRigStats(profile, augments), [profile, augments]);

  // Latest props for the game loop without restarting it.
  const live = useRef(props);
  live.current = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<DrillEngine | null>(null);
  const blocking = useRef(false); // a modal is open: freeze the simulation
  blocking.current = !!modal || !!choice || trader;
  const modalRef = useRef<CardModal | null>(null);
  modalRef.current = modal;
  const keys = useRef(new Set<string>());
  const pointer = useRef({ x: 0, y: 0, down: false, active: false });
  const aimWorld = useRef({ x: 0, y: 0 });
  const bannerTimer = useRef<number | undefined>(undefined);

  const showBanner = useCallback((text: string, color: string) => {
    setBanner({ text, color });
    window.clearTimeout(bannerTimer.current);
    bannerTimer.current = window.setTimeout(() => setBanner(null), 2400);
  }, []);

  const pickCard = useCallback((): Flashcard => {
    const pool = live.current.flashcards.length > 0 ? live.current.flashcards : FALLBACK_CARDS;
    return pool[Math.floor(Math.random() * pool.length)];
  }, []);

  const launch = (p: PlanetDef) => {
    sfx.click();
    onLaunch(p.id, p.launchCost);
    setPlanetId(p.id);
    setResult(null);
    setModal(null); setChoice(null); setTrader(false);
    setHud(null);
    setPhase('playing');
  };

  // ------------------------------------------------------------ game loop
  useEffect(() => {
    if (phase !== 'playing') return;
    const canvas = canvasRef.current!;
    const g = canvas.getContext('2d')!;
    const eng = new DrillEngine(planetId, resolveRigStats(live.current.profile, live.current.augments));
    engineRef.current = eng;
    if (typeof location !== 'undefined' && /[?&]debug/.test(location.search)) {
      (window as unknown as { __coreDrill?: unknown }).__coreDrill = { engine: eng };
    }
    music.start(planetId);
    const cam: Camera = { x: eng.x, y: eng.y - 2, zoom: 1 };
    const view = { w: 800, h: 480 };
    let baseZoom = 1;
    aimWorld.current = { x: eng.x + 3, y: eng.y };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(2, Math.floor(r.width * dpr));
      canvas.height = Math.max(2, Math.floor(r.height * dpr));
      view.w = r.width; view.h = r.height;
      baseZoom = Math.max(0.7, Math.min(1.35, r.height / (15 * TILE)));
    };
    resize();
    cam.zoom = baseZoom;
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const openCard = (mode: CardModal['mode']) => setModal({ mode, card: pickCard(), input: '', revealed: false });

    const handleEvents = (evs: EngineEvent[]) => {
      for (const e of evs) {
        switch (e.type) {
          case 'shoot': sfx.shoot(); break;
          case 'hit': sfx.hit(); break;
          case 'hurt': sfx.hurt(); break;
          case 'dig': sfx.dig(); break;
          case 'ore': sfx.ore(e.tile); break;
          case 'explode': sfx.explode(); break;
          case 'bomb': sfx.bomb(); break;
          case 'enemyDie': sfx.enemyDie(e.boss); break;
          case 'dock': sfx.dock(); showBanner(`SOLD  +${e.scrap} SCRAP${e.cores ? `  +${e.cores} CORE` : ''}`, '#34d399'); break;
          case 'relay': sfx.relay(); showBanner('RELAY STATION — resupplied', '#38bdf8'); break;
          case 'vault': sfx.vault(); openCard('vault'); break;
          case 'emp': sfx.emp(); break;
          case 'raid': sfx.raid(); showBanner('RAID INBOUND — hostile drones from orbit', '#f87171'); break;
          case 'boss': sfx.boss(); music.setIntensity(0.85); showBanner(`${e.name.toUpperCase()} AWAKENS`, eng.planet.primary); break;
          case 'bossDown': music.setIntensity(0); break;
          case 'lowfuel': sfx.lowfuel(); showBanner('LOW FUEL — find a relay or head home', '#fbbf24'); break;
          case 'cargoFull': sfx.cargoFull(); break;
          case 'nest': sfx.nest(); break;
          case 'pickup': sfx.pickup(); break;
          case 'rumble': sfx.rumble(); break;
          case 'tremor': sfx.tremor(); showBanner('TREMOR — rock is coming down!', '#fbbf24'); break;
          case 'surge': sfx.surge(e.on); showBanner(e.on ? 'SIGNAL STORM — lamps failing, swarm incoming' : 'The storm passes', e.on ? '#c084fc' : '#38bdf8'); break;
          case 'ambush': sfx.ambush(); break;
          case 'turret': sfx.turret(); break;
          case 'merchant': sfx.merchant(); setTraderBank(eng.bankedScrap); setTrader(true); break;
          case 'warp': sfx.warp(); setChoice(null); showBanner(`WARP COMPLETE — ${getPlanet(e.planetId).name}`, getPlanet(e.planetId).primary); music.start(e.planetId); setPlanetId(e.planetId); break;
          case 'planetCleared':
            sfx.cleared();
            live.current.onPlanetCleared?.(e.planetId);
            if (e.canWarp) setChoice({ planetId: e.planetId });
            else showBanner('FINAL WORLD CLEARED — keep drilling for glory', '#34d399');
            break;
          case 'end':
            if (e.result.outcome === 'destroyed') sfx.lose(); else sfx.win();
            music.stop();
            live.current.onRunComplete(e.result);
            setResult(e.result);
            setModal(null); setChoice(null); setTrader(false);
            setPhase('result');
            break;
        }
      }
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (modalRef.current) {
        if (ev.code === 'Escape' && modalRef.current.mode === 'override') setModal(null);
        return;
      }
      if (blocking.current) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(ev.code)) ev.preventDefault();
      if (ev.repeat) { keys.current.add(ev.code); return; }
      keys.current.add(ev.code);
      if (ev.code === 'KeyB') eng.placeBomb();
      if (ev.code === 'KeyE') eng.openMerchant();
      if (ev.code === 'KeyF' && eng.overrideReady) { ev.preventDefault(); openCard('override'); }
    };
    const onKeyUp = (ev: KeyboardEvent) => { keys.current.delete(ev.code); };
    const onBlur = () => { keys.current.clear(); pointer.current.down = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    const toWorld = (cx: number, cy: number) => {
      const r = canvas.getBoundingClientRect();
      return { x: (cx - r.left - r.width / 2) / cam.zoom / TILE + cam.x, y: (cy - r.top - r.height / 2) / cam.zoom / TILE + cam.y };
    };
    const onMove = (ev: PointerEvent) => { pointer.current.active = true; pointer.current.x = ev.clientX; pointer.current.y = ev.clientY; };
    const onDown = (ev: PointerEvent) => { pointer.current.down = true; pointer.current.active = true; pointer.current.x = ev.clientX; pointer.current.y = ev.clientY; canvas.setPointerCapture?.(ev.pointerId); };
    const onUp = () => { pointer.current.down = false; };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    let raf = 0;
    let last = performance.now();
    let hudTick = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const k = keys.current;
      const paused = blocking.current || eng.status !== 'running';

      if (pointer.current.active) aimWorld.current = toWorld(pointer.current.x, pointer.current.y);
      else aimWorld.current = { x: eng.x + eng.facing * 4, y: eng.y };

      if (!paused) {
        const input: Input = {
          left: k.has('KeyA') || k.has('ArrowLeft'),
          right: k.has('KeyD') || k.has('ArrowRight'),
          up: k.has('KeyW') || k.has('ArrowUp'),
          down: k.has('KeyS') || k.has('ArrowDown'),
          fire: pointer.current.down || k.has('Space'),
          aimX: aimWorld.current.x,
          aimY: aimWorld.current.y,
        };
        eng.update(dt, input);
        eng.setRecall(k.has('KeyR'), dt);
      }
      // the engine can hold itself in a modal state (vault / choice / trader): the events open the UI
      handleEvents(eng.drainEvents());
      if (eng.status === 'ended') return;

      // pull back and look up a little in boss caverns so the whole fight is on screen
      const inBoss = eng.inBossRoom;
      cam.zoom += (baseZoom * (inBoss ? 0.8 : 1) - cam.zoom) * Math.min(1, dt * 3);
      const halfW = view.w / 2 / cam.zoom / TILE, halfH = view.h / 2 / cam.zoom / TILE;
      const f = Math.min(1, dt * 8);
      cam.x += (eng.x - cam.x) * f;
      cam.y += (eng.y - (inBoss ? 3.5 : 0) - cam.y) * f;
      cam.x = eng.world.w <= halfW * 2 ? eng.world.w / 2 : Math.max(halfW, Math.min(eng.world.w - halfW, cam.x));
      cam.y = Math.max(4, Math.min(eng.world.h - halfH, cam.y));
      render(g, eng, cam, view, pointer.current.active ? aimWorld.current : null, now / 1000);

      if (++hudTick % 4 === 0) {
        const boss = eng.boss;
        setHud({
          hull: eng.hull, maxHull: eng.stats.maxHull, shield: eng.shield, maxShield: eng.stats.maxShield,
          fuel: eng.fuel, maxFuel: eng.stats.maxFuel, energy: eng.energy, maxEnergy: eng.stats.maxEnergy,
          cargo: cargoCount(eng.cargo), cargoCap: eng.stats.cargoCap,
          cargoValue: cargoValue(eng.cargo, eng.planet, eng.stats.oreValueMult).scrap,
          bombs: eng.bombs, depth: eng.depth, banked: eng.bankedScrap, overrideCd: eng.overrideCd,
          recall: eng.recallHeld, onPad: eng.onPad, kills: eng.kills, planetId: eng.planet.id, surge: eng.surgeLeft,
          nearMerchant: eng.nearMerchant, slow: eng.slowT > 0, burn: eng.burnT > 0,
          boss: boss && eng.inBossRoom ? { hp: boss.hp, max: boss.maxHp, name: boss.name } : null,
        });
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      music.stop();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      keys.current.clear();
      pointer.current = { x: 0, y: 0, down: false, active: false };
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, pickCard, showBanner]);

  // ------------------------------------------------------------ modal actions
  const answerCard = (success: boolean) => {
    const m = modalRef.current;
    const eng = engineRef.current;
    if (!m || !eng) return;
    setModal(null);
    sfx.click();
    if (m.mode === 'vault') {
      eng.resolveVault(success);
      if (success) live.current.onVaultSolved?.();
    } else if (success) {
      eng.empBlast();
      live.current.onOverrideSuccess?.();
    }
  };

  const chooseWarp = (warp: boolean) => {
    const eng = engineRef.current;
    if (!eng) return;
    sfx.click();
    setChoice(null);
    if (warp) eng.warp(); else eng.stay();
  };

  const buy = (id: string) => {
    const eng = engineRef.current;
    if (!eng) return;
    if (eng.buyOffer(id)) { sfx.pickup(); setTraderBank(eng.bankedScrap); }
  };
  const closeTrader = () => { engineRef.current?.closeMerchant(); setTrader(false); };

  const touch = (code: string, down: boolean) => () => {
    if (down) keys.current.add(code); else keys.current.delete(code);
  };

  // ------------------------------------------------------------ screens
  if (phase === 'orbit') {
    return (
      <div className="cd-root cd-orbit">
        <div className="cd-orbit-head">
          <div>
            <div className="cd-eyebrow">STUDYOPS · BREAK-ROOM ARCADE</div>
            <h1 className="cd-title">Core Drill <span>Planetfall</span></h1>
            <p className="cd-sub">Reopen the abandoned mines of five dead worlds. Dig down level by level, fight what moved in, and keep going as long as your light and your nerve hold. Everything you earn feeds your Armory.</p>
          </div>
          <div className="cd-chips">
            <span className="cd-chip cd-chip-cyan">⚡ {profile.focusEnergy} EN</span>
            <span className="cd-chip cd-chip-green">🔧 {profile.techScrap} SCRAP</span>
            <span className="cd-chip cd-chip-violet">✦ {profile.neuroCores} CORES</span>
          </div>
        </div>

        <div className="cd-orbit-grid">
          <section className="cd-panel">
            <h2 className="cd-h2">Star map</h2>
            <div className="cd-planets">
              {PLANETS.map((p) => {
                const unlocked = isPlanetUnlocked(p, save.cleared);
                const affordable = profile.focusEnergy >= p.launchCost;
                const cleared = save.cleared.includes(p.id);
                return (
                  <div key={p.id} className={`cd-planet ${unlocked ? '' : 'is-locked'}`} style={{ ['--pc' as string]: p.primary, ['--pa' as string]: p.accent }}>
                    <div className="cd-orb" />
                    <div className="cd-planet-body">
                      <div className="cd-planet-top">
                        <span className="cd-code">{p.code}</span>
                        {cleared && <span className="cd-tag cd-tag-ok">CORE BOSS DOWN</span>}
                        {p.playable && !unlocked && <span className="cd-tag">LOCKED · clear {getPlanet(p.requires).name}</span>}
                      </div>
                      <div className="cd-planet-name">{p.name} <small>{p.subtitle}</small></div>
                      <p className="cd-planet-blurb">{p.blurb}</p>
                      <div className="cd-planet-meta">
                        <span>Best depth {save.bestDepth[p.id] ?? 0} m</span>
                        <span>Core: {p.bossName} (~{coreDepth(p)} m)</span>
                        <span>Ore ×{p.scrapMult.toFixed(1)}</span>
                      </div>
                    </div>
                    <button
                      className="cd-btn cd-btn-launch"
                      disabled={!unlocked || !affordable}
                      onClick={() => launch(p)}
                      title={!unlocked ? 'Locked' : !affordable ? 'Not enough Focus Energy — study to earn more' : ''}
                    >
                      {unlocked ? (affordable ? `Launch · ${p.launchCost} EN` : `Need ${p.launchCost} EN`) : 'Locked'}
                    </button>
                  </div>
                );
              })}
            </div>
            {profile.focusEnergy < PLANETS[0].launchCost && onNavigateToFocus && (
              <button className="cd-btn cd-btn-ghost" onClick={onNavigateToFocus}>Low on Focus Energy — start a study session →</button>
            )}
          </section>

          <section className="cd-side">
            <div className="cd-panel">
              <h2 className="cd-h2">Rig loadout</h2>
              <dl className="cd-stats">
                <div><dt>Fuel</dt><dd>{stats.maxFuel}</dd></div>
                <div><dt>Hull</dt><dd>{stats.maxHull}</dd></div>
                <div><dt>Shield</dt><dd>{stats.maxShield}</dd></div>
                <div><dt>Cargo</dt><dd>{stats.cargoCap} slots</dd></div>
                <div><dt>Dig speed</dt><dd>×{stats.drillSpeed.toFixed(2)}</dd></div>
                <div><dt>Blaster</dt><dd>{stats.blasterDamage} dmg · {stats.blasterRate.toFixed(1)}/s</dd></div>
                <div><dt>Crit</dt><dd>{Math.round(stats.critChance * 100)}%</dd></div>
                <div><dt>Ore value</dt><dd>×{stats.oreValueMult.toFixed(2)}</dd></div>
                <div><dt>Light</dt><dd>+{stats.lightBonus.toFixed(1)} tiles</dd></div>
                <div><dt>Pad turret</dt><dd>{stats.turretLevel ? `Lv ${stats.turretLevel}` : 'none'}</dd></div>
              </dl>
              <div className="cd-augs">
                {stats.augmentNames.length === 0
                  ? <span className="cd-muted">No active subject augments — finish a study session to power up your rig.</span>
                  : stats.augmentNames.map((n) => <span key={n} className="cd-aug">{n}</span>)}
              </div>
              {profile.streakDays > 0 && <div className="cd-muted">🔥 {profile.streakDays}-day streak: +{Math.min(profile.streakDays, 10) * 2} fuel</div>}
            </div>

            <div className="cd-panel">
              <h2 className="cd-h2">Station shop <small>Tech Scrap</small></h2>
              <div className="cd-shop">
                {UPGRADES.map((u) => {
                  const lvl = save.upgrades[u.key];
                  const maxed = lvl >= u.max;
                  const cost = upgradeCost(u, lvl);
                  return (
                    <div key={u.key} className="cd-shop-row">
                      <div>
                        <div className="cd-shop-name">{u.name}</div>
                        <div className="cd-muted">{u.perLevel}</div>
                        <div className="cd-pips">{Array.from({ length: u.max }, (_, i) => <i key={i} className={i < lvl ? 'on' : ''} />)}</div>
                      </div>
                      <button className="cd-btn cd-btn-buy" disabled={maxed || profile.techScrap < cost} onClick={() => { sfx.click(); onBuyUpgrade(u.key, cost); }}>
                        {maxed ? 'MAX' : `${cost}`}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="cd-panel cd-help">
              <h2 className="cd-h2">Controls</h2>
              <ul>
                <li><b>A / D</b> drive · <b>W</b> thrusters · <b>S</b> dig down (hold toward rock to dig sideways)</li>
                <li><b>Mouse / Space</b> fire · <b>B</b> bomb · <b>F</b> flashcard Override · <b>E</b> trade</li>
                <li>Every level has a steel <b>plate floor</b>: find the ladder shaft in the drift, or bomb through. Relays refuel you every third level.</li>
                <li>The deeper you go, the less you can see. Hold <b>R</b> to recall (25% fee away from the pad).</li>
              </ul>
            </div>
          </section>
        </div>
      </div>
    );
  }

  const planet = getPlanet(hud?.planetId ?? planetId);

  if (phase === 'result' && result) {
    const title = result.outcome === 'destroyed' ? 'RIG DESTROYED' : result.clears.length ? 'EXPEDITION COMPLETE' : 'RIG RECALLED';
    const tone = result.outcome === 'destroyed' ? 'bad' : result.clears.length ? 'ok' : 'warn';
    const start = getPlanet(result.planetId);
    return (
      <div className="cd-root cd-result" style={{ ['--pc' as string]: start.primary }}>
        <div className={`cd-result-card tone-${tone}`}>
          <div className="cd-eyebrow">{start.code} · {start.name}</div>
          <h1 className="cd-title">{title}</h1>
          <p className="cd-sub">
            {result.outcome === 'destroyed' ? 'Half your unsold cargo was lost in the wreck.' : 'You made it out with your cargo.'}
            {result.clears.length > 0 && ` Core bosses beaten: ${result.clears.map((id) => getPlanet(id).name).join(', ')}.`}
          </p>
          <div className="cd-result-grid">
            <div><b>+{result.scrap}</b><span>Tech Scrap</span></div>
            <div><b>+{result.neuroCores}</b><span>Neuro-Cores</span></div>
            <div><b>{result.depth} m</b><span>Max depth</span></div>
            <div><b>{result.kills}</b><span>Glitches purged</span></div>
            <div><b>{result.bossesDown}</b><span>Bosses downed</span></div>
            <div><b>{result.vaultsOpened}</b><span>Vaults decrypted</span></div>
          </div>
          <div className="cd-result-actions">
            <button className="cd-btn cd-btn-launch" onClick={() => { sfx.click(); setPhase('orbit'); }}>Return to orbit</button>
          </div>
        </div>
      </div>
    );
  }

  // ---- playing
  const h = hud;
  const warpTarget = choice ? nextPlanet(choice.planetId) : null;
  return (
    <div className="cd-root cd-play" style={{ ['--pc' as string]: planet.primary }}>
      <canvas ref={canvasRef} className="cd-canvas" />
      {h && (
        <>
          <div className="cd-hud-left">
            <Bar label="HULL" value={h.hull} max={h.maxHull} color="#f87171" />
            <Bar label="SHIELD" value={h.shield} max={h.maxShield} color="#38bdf8" />
            <Bar label="FUEL" value={h.fuel} max={h.maxFuel} color={h.fuel < h.maxFuel * 0.2 ? '#fbbf24' : '#34d399'} />
            <Bar label="BLASTER" value={h.energy} max={h.maxEnergy} color="#67e8f9" />
            {(h.slow || h.burn) && <div className="cd-status">{h.slow ? '❄ SLOWED ' : ''}{h.burn ? '🔥 BURNING' : ''}</div>}
          </div>
          <div className="cd-hud-top">
            <div className="cd-depth">{planet.code} · DEPTH <b>{h.depth}</b> m{h.surge > 0 && <span className="cd-surge"> · SIGNAL STORM {Math.ceil(h.surge)}s</span>}</div>
            {h.boss && (
              <div className="cd-boss">
                <span>{h.boss.name}</span>
                <div><i style={{ width: pct(h.boss.hp, h.boss.max) }} /></div>
              </div>
            )}
          </div>
          <div className="cd-hud-right">
            <div className="cd-pill">CARGO <b>{h.cargo}/{h.cargoCap}</b> · ≈{h.cargoValue} scrap</div>
            <div className="cd-pill">BANKED <b>{h.banked}</b></div>
            <div className="cd-pill">BOMBS <b>{h.bombs}</b> <kbd>B</kbd></div>
            <button
              className={`cd-override ${h.overrideCd > 0 ? 'cooling' : ''}`}
              disabled={h.overrideCd > 0}
              onClick={() => { const e = engineRef.current; if (e && e.overrideReady && !modalRef.current) setModal({ mode: 'override', card: pickCard(), input: '', revealed: false }); }}
            >
              {h.overrideCd > 0 ? `OVERRIDE ${Math.ceil(h.overrideCd)}s` : 'OVERRIDE · F'}
            </button>
            <button className="cd-mute" onClick={() => { setMuted(!muted); setMutedState(!muted); }} aria-label="Toggle sound">{muted ? '🔇' : '🔊'}</button>
          </div>
          {h.recall > 0 && <div className="cd-recall">RECALLING… {Math.max(0, 2.5 - h.recall).toFixed(1)}s</div>}
          {h.onPad && (
            <div className="cd-hint">
              Docked — ore sold, rig refuelled and repaired. Dig down to keep going, or{' '}
              <button className="cd-inline-btn" onClick={() => engineRef.current?.finish('recalled')}>end the run and bank everything</button>.
            </div>
          )}
          {!h.onPad && h.nearMerchant && <div className="cd-hint">A derelict trader hums in the dark. Press <kbd>E</kbd> to trade.</div>}
        </>
      )}
      {banner && <div className="cd-banner" style={{ color: banner.color, borderColor: banner.color }}>{banner.text}</div>}

      <div className="cd-touch">
        <div className="cd-dpad">
          <button onPointerDown={touch('KeyW', true)} onPointerUp={touch('KeyW', false)} onPointerLeave={touch('KeyW', false)} className="u">▲</button>
          <button onPointerDown={touch('KeyA', true)} onPointerUp={touch('KeyA', false)} onPointerLeave={touch('KeyA', false)} className="l">◀</button>
          <button onPointerDown={touch('KeyS', true)} onPointerUp={touch('KeyS', false)} onPointerLeave={touch('KeyS', false)} className="d">▼</button>
          <button onPointerDown={touch('KeyD', true)} onPointerUp={touch('KeyD', false)} onPointerLeave={touch('KeyD', false)} className="r">▶</button>
        </div>
        <div className="cd-actions">
          <button onPointerDown={() => engineRef.current?.openMerchant()}>TRADE</button>
          <button onPointerDown={() => engineRef.current?.placeBomb()}>BOMB</button>
          <button onPointerDown={touch('Space', true)} onPointerUp={touch('Space', false)} onPointerLeave={touch('Space', false)}>FIRE</button>
        </div>
      </div>

      {modal && (
        <div className="cd-modal-wrap">
          <div className="cd-modal">
            <div className="cd-eyebrow" style={{ color: SUBJECT_COLORS[modal.card.subject] }}>
              {modal.mode === 'vault' ? 'VAULT ENCRYPTION' : 'ACADEMIC OVERRIDE'} · {modal.card.deck}
            </div>
            <h2 className="cd-q">{modal.card.question}</h2>
            {modal.card.hint && !modal.revealed && <p className="cd-muted">Hint: {modal.card.hint}</p>}
            <input
              className="cd-input"
              placeholder="Type your answer (optional), then reveal"
              value={modal.input}
              autoFocus
              onChange={(e) => setModal({ ...modal, input: e.target.value })}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') setModal({ ...modal, revealed: true }); }}
            />
            {!modal.revealed ? (
              <div className="cd-modal-actions">
                <button className="cd-btn cd-btn-launch" onClick={() => setModal({ ...modal, revealed: true })}>Reveal answer</button>
                {modal.mode === 'override' && <button className="cd-btn cd-btn-ghost" onClick={() => setModal(null)}>Cancel</button>}
              </div>
            ) : (
              <>
                <div className="cd-answer">{modal.card.answer}</div>
                <p className="cd-muted">Be honest — did you get it right?</p>
                <div className="cd-modal-actions">
                  <button className="cd-btn cd-btn-launch" onClick={() => answerCard(true)}>I got it</button>
                  <button className="cd-btn cd-btn-ghost" onClick={() => answerCard(false)}>Missed it</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {choice && (
        <div className="cd-modal-wrap">
          <div className="cd-modal cd-modal-wide" style={{ borderColor: planet.primary }}>
            <div className="cd-eyebrow" style={{ color: planet.primary }}>{planet.code} · CORE SECURED</div>
            <h2 className="cd-q">{planet.bossName} is offline.</h2>
            <p className="cd-muted">The mine keeps going. You can stay and push deeper (guardian bosses return every few levels and the dark closes in), or warp on to the next world with your hull, cargo and bombs intact.</p>
            <div className="cd-modal-actions cd-choice">
              {warpTarget && (
                <button className="cd-btn cd-btn-launch" onClick={() => chooseWarp(true)}>
                  Warp to {warpTarget.name}
                  <small>fuel refilled · hull +50% · cargo kept</small>
                </button>
              )}
              <button className="cd-btn cd-btn-ghost" onClick={() => chooseWarp(false)}>
                Stay on {planet.name}
                <small>keep digging, endless depth</small>
              </button>
            </div>
          </div>
        </div>
      )}

      {trader && (
        <div className="cd-modal-wrap">
          <div className="cd-modal cd-modal-wide">
            <div className="cd-eyebrow" style={{ color: '#fbbf24' }}>DERELICT TRADER</div>
            <h2 className="cd-q">"Parts. Fuel. No questions."</h2>
            <p className="cd-muted">Pays from the scrap you have already banked this run: <b style={{ color: '#34d399' }}>{traderBank}</b></p>
            <div className="cd-offers">
              {MERCHANT_OFFERS.map((o) => (
                <button key={o.id} className="cd-offer" disabled={traderBank < o.cost} onClick={() => buy(o.id)}>
                  <span><b>{o.label}</b><small>{o.detail}</small></span>
                  <em>{o.cost}</em>
                </button>
              ))}
            </div>
            <div className="cd-modal-actions"><button className="cd-btn cd-btn-ghost" onClick={closeTrader}>Leave</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="cd-bar">
      <span>{label}</span>
      <div><i style={{ width: pct(value, max), background: color }} /></div>
      <b>{Math.ceil(value)}</b>
    </div>
  );
}
