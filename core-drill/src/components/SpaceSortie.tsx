import { useCallback, useEffect, useRef, useState } from 'react';
import { getPlanet, resolveRigStats } from '../game/balance';
import { isMuted, music, setMuted, sfx } from '../game/sfx';
import { loadSpaceAssets, SpaceAssets } from '../space/assets';
import { ARENA_H, ARENA_W, SEvent, SInput, SortieResult, SpaceEngine } from '../space/engine';
import { renderSpace, spaceScale } from '../space/render';
import type { DrillProfile, Flashcard, SubjectCombatAugment } from '../types';

export interface SpaceSortieProps {
  planetId: number;
  profile: DrillProfile;
  augments: SubjectCombatAugment[];
  flashcards: Flashcard[];
  /** Called once when the sortie ends; the host banks the rewards. */
  onComplete: (result: SortieResult) => void;
  /** Back to the star map. */
  onExit: () => void;
  onOverrideSuccess?: () => void;
}

const FALLBACK: Flashcard[] = [
  { id: 's1', subject: 'math', deck: 'Orbital Diagnostics', question: 'Solve for x: 3x - 7 = 14', answer: 'x = 7', hint: 'Add 7, then divide by 3', mastered: false },
  { id: 's2', subject: 'science', deck: 'Physics', question: 'What is the unit of force?', answer: 'The newton (N)', mastered: false },
  { id: 's3', subject: 'cs', deck: 'Algorithms', question: 'Average time complexity of binary search?', answer: 'O(log n)', mastered: false },
];

interface Card { card: Flashcard; input: string; revealed: boolean }

export default function SpaceSortie(props: SpaceSortieProps) {
  const { planetId, onExit } = props;
  const live = useRef(props);
  live.current = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engRef = useRef<SpaceEngine | null>(null);
  const [assets, setAssets] = useState<SpaceAssets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SortieResult | null>(null);
  const [banner, setBanner] = useState<{ text: string; tone: string } | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [hint, setHint] = useState(true);
  const [muted, setMutedState] = useState(isMuted());
  const [ovCd, setOvCd] = useState(0);
  const cardRef = useRef<Card | null>(null);
  cardRef.current = card;
  const keys = useRef(new Set<string>());
  const pointer = useRef({ x: 0, y: 0, down: false, active: false });
  const bannerTimer = useRef<number | undefined>(undefined);

  const planet = getPlanet(planetId);

  const showBanner = useCallback((text: string, tone: string) => {
    setBanner({ text, tone });
    window.clearTimeout(bannerTimer.current);
    bannerTimer.current = window.setTimeout(() => setBanner(null), 2200);
  }, []);

  useEffect(() => {
    let alive = true;
    loadSpaceAssets().then((a) => { if (alive) setAssets(a); }).catch((e) => { if (alive) setError(String(e.message ?? e)); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!assets || !canvasRef.current) return;
    const A = assets;
    const canvas = canvasRef.current;
    const g = canvas.getContext('2d')!;
    const eng = new SpaceEngine(planetId, resolveRigStats(live.current.profile, live.current.augments));
    engRef.current = eng;
    if (typeof location !== 'undefined' && /[?&]debug/.test(location.search)) (window as unknown as { __sortie?: unknown }).__sortie = { engine: eng };
    music.start(planetId);
    music.setIntensity(0.35);

    const view = { w: 800, h: 480 };
    let dpr = 1;
    const cam = { x: eng.x, y: eng.y };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(2, Math.floor(r.width * dpr));
      canvas.height = Math.max(2, Math.floor(r.height * dpr));
      view.w = r.width; view.h = r.height;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const openOverride = () => {
      if (!eng.overrideReady || cardRef.current) return;
      const pool = live.current.flashcards.length ? live.current.flashcards : FALLBACK;
      setCard({ card: pool[Math.floor(Math.random() * pool.length)], input: '', revealed: false });
    };

    const onEvent = (e: SEvent) => {
      switch (e.type) {
        case 'shoot': sfx.shoot(); break;
        case 'missile': sfx.bomb(); break;
        case 'hit': sfx.hit(); break;
        case 'hurt': sfx.hurt(); break;
        case 'explode': sfx.explode(); break;
        case 'pickup': sfx.pickup(); break;
        case 'crew': sfx.relay(); break;
        case 'emp': sfx.emp(); break;
        case 'lowfuel': sfx.lowfuel(); showBanner('LOW FUEL — grab a fuel cell or let the tank trickle back', 'warn'); break;
        case 'wave': sfx.raid(); music.setIntensity(e.boss ? 0.9 : 0.5); showBanner(e.boss ? `WAVE ${e.wave} — BOSS INBOUND` : `WAVE ${e.wave}`, e.boss ? 'bad' : 'info'); break;
        case 'waveClear': sfx.cleared(); music.setIntensity(0.3); showBanner(`WAVE CLEARED  +${e.bonus} SCRAP`, 'ok'); break;
        case 'boss': sfx.boss(); showBanner(`${e.name.toUpperCase()}`, 'bad'); break;
        case 'bossDown': sfx.win(); music.setIntensity(0.3); break;
        case 'end':
          if (e.result.outcome === 'destroyed') sfx.lose(); else sfx.win();
          music.stop();
          live.current.onComplete(e.result);
          setResult(e.result);
          setCard(null);
          break;
      }
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (cardRef.current) { if (ev.code === 'Escape') setCard(null); return; }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(ev.code)) ev.preventDefault();
      keys.current.add(ev.code);
      setHint(false);
      if (ev.repeat) return;
      if (ev.code === 'KeyB' || ev.code === 'KeyQ') eng.fireMissile();
      if (ev.code === 'KeyF') { ev.preventDefault(); openOverride(); }
    };
    const onKeyUp = (ev: KeyboardEvent) => { keys.current.delete(ev.code); };
    const onBlur = () => { keys.current.clear(); pointer.current.down = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    const onMove = (ev: PointerEvent) => { pointer.current.active = true; pointer.current.x = ev.clientX; pointer.current.y = ev.clientY; };
    const onDown = (ev: PointerEvent) => {
      pointer.current.active = true; pointer.current.x = ev.clientX; pointer.current.y = ev.clientY; setHint(false);
      if (ev.button === 2) eng.fireMissile(); else pointer.current.down = true;
      canvas.setPointerCapture?.(ev.pointerId);
    };
    const onUp = () => { pointer.current.down = false; };
    const noMenu = (ev: Event) => ev.preventDefault();
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('contextmenu', noMenu);

    let raf = 0, last = performance.now(), tick = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const S = spaceScale(view);
      const k = keys.current;
      const aim = { x: cam.x + (pointer.current.x - canvas.getBoundingClientRect().left - view.w / 2) / S, y: cam.y + (pointer.current.y - canvas.getBoundingClientRect().top - view.h / 2) / S };
      const aimOut = pointer.current.active ? aim : { x: eng.x + Math.cos(eng.angle) * 60, y: eng.y + Math.sin(eng.angle) * 60 };
      if (eng.status === 'running' && !cardRef.current) {
        const input: SInput = {
          moveX: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
          moveY: (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0),
          boost: k.has('ShiftLeft') || k.has('ShiftRight'),
          fire: pointer.current.down || k.has('Space'),
          aimX: aimOut.x, aimY: aimOut.y,
        };
        eng.update(dt, input);
        eng.setRecall(k.has('KeyR'), dt);
      }
      for (const e of eng.drainEvents()) onEvent(e);
      // camera follows with a little lead, and never shows much beyond the arena
      const halfW = view.w / S / 2, halfH = view.h / S / 2;
      cam.x += (eng.x + eng.vx * 0.25 - cam.x) * Math.min(1, dt * 6);
      cam.y += (eng.y + eng.vy * 0.25 - cam.y) * Math.min(1, dt * 6);
      cam.x = Math.max(halfW - 40, Math.min(ARENA_W - halfW + 40, cam.x));
      cam.y = Math.max(halfH - 40, Math.min(ARENA_H - halfH + 40, cam.y));
      renderSpace(g, eng, cam, view, dpr, pointer.current.active ? aim : null, now / 1000, A);
      if (++tick % 6 === 0) setOvCd(eng.overrideCd);
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
      canvas.removeEventListener('contextmenu', noMenu);
      keys.current.clear();
      engRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, planetId, showBanner]);

  const answer = (ok: boolean) => {
    const eng = engRef.current;
    setCard(null);
    sfx.click();
    if (ok && eng) { eng.empBlast(); live.current.onOverrideSuccess?.(); }
  };

  if (error) return <div className="cd-root cd-result"><div className="cd-result-card px-panel dark"><h1 className="cd-title">Could not load the sprites</h1><p className="cd-sub">{error}</p><button className="cd-btn px-btn blue" onClick={onExit}>Back</button></div></div>;

  if (result) {
    const title = result.outcome === 'destroyed' ? 'SHIP LOST' : 'SORTIE COMPLETE';
    return (
      <div className="cd-root cd-result" style={{ ['--pc' as string]: planet.primary }}>
        <div className={`cd-result-card px-panel dark tone-${result.outcome === 'destroyed' ? 'bad' : 'ok'}`}>
          <div className="cd-eyebrow">{planet.code} · ORBITAL PATROL</div>
          <h1 className="cd-title">{title}</h1>
          <p className="cd-sub">{result.outcome === 'destroyed' ? 'Half of what you carried went down with the ship.' : 'You pulled out with everything you picked up.'}</p>
          <div className="cd-result-grid">
            <div className="px-slot"><b>+{result.scrap}</b><span>Tech Scrap</span></div>
            <div className="px-slot"><b>+{result.neuroCores}</b><span>Neuro-Cores</span></div>
            <div className="px-slot"><b>{result.wave}</b><span>Waves cleared</span></div>
            <div className="px-slot"><b>{result.kills}</b><span>Hostiles down</span></div>
            <div className="px-slot"><b>{result.crewRescued}</b><span>Crew rescued</span></div>
            <div className="px-slot"><b>{result.bossesDown}</b><span>Bosses</span></div>
          </div>
          <div className="cd-result-actions"><button className="cd-btn px-btn blue" onClick={() => { sfx.click(); onExit(); }}>Return to orbit</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="cd-root cd-play cd-space" style={{ ['--pc' as string]: planet.primary }}>
      <canvas ref={canvasRef} className="cd-canvas" />
      {!assets && <div className="cd-loading">Warming up the thrusters…</div>}
      {assets && (
        <div className="cd-hud-right cd-space-actions">
          <button className={`cd-override px-btn green ${ovCd > 0 ? 'cooling' : ''}`} disabled={ovCd > 0} onClick={() => { const e = engRef.current; if (e?.overrideReady && !cardRef.current) { const pool = live.current.flashcards.length ? live.current.flashcards : FALLBACK; setCard({ card: pool[Math.floor(Math.random() * pool.length)], input: '', revealed: false }); } }}>
            {ovCd > 0 ? `OVERRIDE ${Math.ceil(ovCd)}s` : 'OVERRIDE · F'}
          </button>
          <button className="cd-mute px-btn grey" onClick={() => { setMuted(!muted); setMutedState(!muted); }} aria-label="Toggle sound">{muted ? '🔇' : '🔊'}</button>
          <button className="cd-retreat px-btn orange" onClick={() => engRef.current?.finish('retreat')} title="Retreat and keep your haul">RETREAT</button>
        </div>
      )}
      {banner && <div className={`cd-banner px-banner ${banner.tone}`}>{banner.text}</div>}
      {assets && hint && (
        <div className="cd-hint px-panel dark">
          <b>WASD</b> thrust · <b>Shift</b> boost · <b>mouse</b> aim · <b>click / Space</b> fire · <b>B / right-click</b> missile · <b>F</b> flashcard Override · hold <b>R</b> to retreat
        </div>
      )}
      {card && (
        <div className="cd-modal-wrap">
          <div className="cd-modal px-panel dark">
            <div className="cd-eyebrow" style={{ color: '#86efac' }}>ACADEMIC OVERRIDE · {card.card.deck}</div>
            <h2 className="cd-q">{card.card.question}</h2>
            {card.card.hint && !card.revealed && <p className="cd-muted">Hint: {card.card.hint}</p>}
            <input className="cd-input px-input" placeholder="Type your answer (optional), then reveal" value={card.input} autoFocus
              onChange={(e) => setCard({ ...card, input: e.target.value })}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') setCard({ ...card, revealed: true }); }} />
            {!card.revealed ? (
              <div className="cd-modal-actions">
                <button className="cd-btn px-btn blue" onClick={() => setCard({ ...card, revealed: true })}>Reveal answer</button>
                <button className="cd-btn px-btn grey" onClick={() => setCard(null)}>Cancel</button>
              </div>
            ) : (
              <>
                <div className="cd-answer">{card.card.answer}</div>
                <p className="cd-muted">Be honest — did you get it right?</p>
                <div className="cd-modal-actions">
                  <button className="cd-btn px-btn green" onClick={() => answer(true)}>I got it</button>
                  <button className="cd-btn px-btn grey" onClick={() => answer(false)}>Missed it</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
