/**
 * Standalone harness: a mock StudyOps profile so Core Drill can be played and tested
 * without the rest of the app. Mirrors what App.tsx does with the real callbacks.
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CoreDrillGame from '../components/CoreDrillGame';
import { applyRunResult, buyUpgrade, launchPlanet } from '../game/progress';
import type { DrillProfile, Flashcard, SubjectCombatAugment } from '../types';

const params = new URLSearchParams(location.search);
const n = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);

const augment = (subject: SubjectCombatAugment['subject'], over: Partial<SubjectCombatAugment>): SubjectCombatAugment => ({
  subject, name: 'Augment', effect: '', activeUntil: Date.now() + 2 * 3600_000,
  critChanceBonus: 0, shieldBonus: 0, turretRateBonus: 0, scrapMultiplierBonus: 0, damageReductionBonus: 0, ...over,
});

const AUGMENTS: Record<string, SubjectCombatAugment> = {
  math: augment('math', { name: 'Quantum Precision Matrix', critChanceBonus: 0.25 }),
  science: augment('science', { name: 'Tesla Shield Overcharge', shieldBonus: 40, damageReductionBonus: 0.1 }),
  cs: augment('cs', { name: 'Algorithmic Overclock', turretRateBonus: 0.3 }),
  humanities: augment('humanities', { name: 'Data Frequency Scavenger', scrapMultiplierBonus: 0.4 }),
  arts: augment('arts', { name: 'Chromatic Camouflage', damageReductionBonus: 0.25 }),
};

const FLASHCARDS: Flashcard[] = [
  { id: '1', subject: 'math', deck: 'Calculus', question: 'd/dx of sin(x)?', answer: 'cos(x)', hint: 'Cosine', mastered: false },
  { id: '2', subject: 'science', deck: 'Chemistry', question: 'Chemical symbol for sodium?', answer: 'Na', mastered: false },
  { id: '3', subject: 'languages', deck: 'French', question: 'How do you say "thank you" in French?', answer: 'Merci', mastered: false },
];

function Harness() {
  const [profile, setProfile] = useState<DrillProfile>({
    focusEnergy: n('en', 300), techScrap: n('scrap', 420), neuroCores: 3, streakDays: n('streak', 4),
  });
  const augments = (params.get('aug') ?? 'math,cs').split(',').filter(Boolean).map((k) => AUGMENTS[k]).filter(Boolean);
  return (
    <CoreDrillGame
      profile={profile}
      augments={augments}
      flashcards={FLASHCARDS}
      onLaunch={(id, cost) => setProfile((p) => launchPlanet(p, id, cost))}
      onRunComplete={(r) => setProfile((p) => applyRunResult(p, r))}
      onBuyUpgrade={(key, cost) => setProfile((p) => buyUpgrade(p, key, cost))}
      onOverrideSuccess={() => console.log('override success')}
      onVaultSolved={() => console.log('vault solved')}
    />
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
