'use strict';
// Village mode, part 6: the Research and Options panels, the market, and the richer top-right HUD.
const pips = (n, max) => '<span class="pips">' + Array.from({ length: max }, (_, k) => `<i class="${k < n ? 'on' : ''}"></i>`).join('') + '</span>';

// ---------------------------------------------------------------- research + hero training
let resTab = 'village';
function openResearch(tab) {
  if (tab) resTab = tab;
  const tabs = $('resTabs'); tabs.innerHTML = '';
  for (const [k, label] of [['village', 'Village research'], ['hero', 'Hero training']]) {
    const b = document.createElement('button'); b.textContent = label + (k === 'hero' && skillPoints() > 0 ? ` (${skillPoints()})` : ''); b.className = k === resTab ? 'on' : ''; b.onclick = () => openResearch(k); tabs.appendChild(b);
  }
  const grid = $('resGrid'); grid.innerHTML = '';
  $('resRes').innerHTML = resTab === 'village' ? `${ICO.gold} ${Math.floor(V.res.gold)} gold · ${ICO.wood} ${Math.floor(V.res.wood)} wood` : `Skill points <b>${skillPoints()}</b> · Hero level ${V.heroLevel}`;
  if (resTab === 'village') {
    if (!hasAcademy()) {
      const note = document.createElement('div'); note.className = 'resnote';
      const have = V.buildings.some(b => b.type === 'academy');
      note.innerHTML = have ? 'Your Academy is still being built.' : `Build an <b>Academy</b> (Town Hall level ${minHallFor('academy')}) to research village upgrades.`;
      if (!have) { const btn = document.createElement('button'); btn.className = 'btn gold'; btn.textContent = 'Open the shop'; btn.onclick = () => { closeResearch(); shopCat = 'Utility'; openShop(); }; note.appendChild(btn); }
      grid.appendChild(note);
    }
    for (const k of TECH_ORDER) {
      const T = TECH[k], n = tech(k), why = techCheck(k), cost = n < T.max ? T.cost(n) : null;
      const card = document.createElement('div'); card.className = 'tech' + (n >= T.max ? ' done' : '');
      card.innerHTML = `<div class="ti">${T.ico}</div><div class="tb"><b>${T.name}</b>${pips(n, T.max)}<small>${T.per} per level${n ? ` · now ${describeTech(k, n)}` : ''}</small>${cost ? `<div class="row">${costHtml(cost)}</div>` : ''}</div>`;
      const btn = document.createElement('button'); btn.className = 'btn' + (why ? '' : ' gold'); btn.textContent = n >= T.max ? 'Mastered' : 'Research'; btn.disabled = n >= T.max; btn.title = why || '';
      btn.onclick = () => { const w = researchTech(k); if (w) toast2(w); openResearch(); };
      card.appendChild(btn); grid.appendChild(card);
    }
  } else {
    for (const k of TRAIN_ORDER) {
      const T = TRAIN[k], n = V.train[k] || 0;
      const card = document.createElement('div'); card.className = 'tech' + (n >= T.max ? ' done' : '');
      card.innerHTML = `<div class="ti">${T.ico}</div><div class="tb"><b>${T.name}</b>${pips(n, T.max)}<small>${T.per} per level</small></div>`;
      const btn = document.createElement('button'); btn.className = 'btn' + (skillPoints() > 0 && n < T.max ? ' gold' : ''); btn.textContent = n >= T.max ? 'Mastered' : 'Train +1'; btn.disabled = n >= T.max || skillPoints() <= 0;
      btn.onclick = () => { const w = trainHero(k); if (w) toast2(w); openResearch(); };
      card.appendChild(btn); grid.appendChild(card);
    }
    const ab = document.createElement('div'); ab.className = 'resnote wide';
    ab.innerHTML = `<b>Abilities.</b> Hero strike <kbd>Space</kbd> from level 1 · Second Wind <kbd>H</kbd> from level 1 · <b>Battle Cry</b> <kbd>B</kbd> from level ${HERO_DEF.cryLevel}: ${Math.round((HERO_DEF.cryDmg - 1) * 100)}% more damage for you and +${Math.round((HERO_DEF.cryGuard - 1) * 100)}% for nearby guards for ${HERO_DEF.cryDur}s.`;
    grid.appendChild(ab);
  }
  $('research').classList.add('show');
}
function describeTech(k, n) {
  switch (k) {
    case 'prospect': case 'forestry': case 'granary': case 'fletching': case 'gunnery': case 'arcana': return '+' + 12 * n + '%';
    case 'masonry': return '+' + 8 * n + '% health';
    case 'carpentry': return '-' + 8 * n + '% time';
    case 'tactics': return '+' + 10 * n + '%';
  }
  return '';
}
function closeResearch() { $('research').classList.remove('show'); }

// ---------------------------------------------------------------- options
function openOptions() {
  const el = $('optBody');
  const seg = (key, items, cur) => `<div class="seg" data-key="${key}">${items.map(([v, label]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  const row = (title, sub, ctl) => `<div class="orow"><div><b>${title}</b><small>${sub}</small></div>${ctl}</div>`;
  const D = DIFF[SET.diff];
  el.innerHTML =
    row('Raid difficulty', `${D.name}: raiders have ${Math.round(D.hp * 100)}% health and ${Math.round(D.dmg * 100)}% damage, ${Math.round(D.count * 100)}% as many come, rewards ${Math.round(D.reward * 100)}%. Applies from the next raid.`, seg('diff', Object.keys(DIFF).map(k => [k, DIFF[k].name]), SET.diff)) +
    row('Game speed', 'Run the whole village faster. Handy while you wait for builders.', seg('speed', [[1, '1×'], [2, '2×'], [3, '3×']], SET.speed)) +
    row('Auto-collect', 'Mines and lumber camps send a cart as soon as their store is full.', seg('auto', [[true, 'On'], [false, 'Off']], SET.auto)) +
    row('Damage numbers', 'Red numbers floating up from hits.', seg('nums', [[true, 'On'], [false, 'Off']], SET.nums)) +
    row('Health bars', 'Bars over hurt units and buildings.', seg('bars', [['hurt', 'Show'], ['off', 'Hide']], SET.bars)) +
    row('Swaying trees', 'Trees rock gently when zoomed in. Turn off for a smoother frame rate on slow machines.', seg('sway', [[true, 'On'], [false, 'Off']], SET.sway));
  el.querySelectorAll('.seg').forEach(sg => sg.querySelectorAll('button').forEach(b => b.onclick = () => {
    const key = sg.dataset.key; let v = b.dataset.v;
    v = v === 'true' ? true : v === 'false' ? false : key === 'speed' ? +v : v;
    SET[key] = v; saveSettings(); Sfx.play('click'); openOptions(); refreshHud();
  }));
  $('options').classList.add('show');
}
function closeOptions() { $('options').classList.remove('show'); }

// ---------------------------------------------------------------- market
function marketPanel() {
  const m = (kind, label, mult) => { const T = TRADE[kind], n = T.n * mult; const ok = V.res[T.give] >= n; return `<button class="btn${ok ? '' : ' off'}" data-act="trade" data-id="${kind}:${mult}">${label}</button>`; };
  return `<div class="acts"><span style="color:var(--mute)">Trade (lossy rates):</span>${m('sellWood', 'Sell 100 wood → 55 gold', 1)}${m('sellWood', '500 wood → 275 gold', 5)}${m('buyWood', '100 gold → 75 wood', 1)}${m('buyWood', '500 gold → 375 wood', 5)}</div>`;
}

// ---------------------------------------------------------------- top-right HUD
function incomePerMin() {
  let g = 0, w = 0;
  for (const b of V.buildings) { const d = BDEF[b.type]; if (b.state === 'built' && d.kind === 'collector') { const r = d.rate[b.level - 1] * 60 * (1 + 0.12 * tech(d.res === 'gold' ? 'prospect' : 'forestry')); if (d.res === 'gold') g += r; else w += r; } }
  return { g: Math.round(g), w: Math.round(w) };
}
let hudSig = '';
function refreshHud2() {
  const h = V.hero, st = heroStats(), title = HERO_DEF.titles[Math.min(3, Math.floor((V.heroLevel - 1) / 4))], r = V.raid;
  const sp = skillPoints(), inc = incomePerMin(), kills = h ? h.hero_kills : 0;
  const sig = [V.heroLevel, sp, heroTierNow(), r.active, r.n, SET.diff, inc.g, inc.w, st.dmg, Math.round(st.red * 100), V.kills, kills].join('|');
  if (sig !== hudSig) {
    hudSig = sig;
    $('hudPortrait').style.cssText = portraitStyle(1.0, 38, 50, true);
    $('hudName').textContent = HERO_DEF.name;
    $('hudTitle').textContent = `${title} · Level ${V.heroLevel}`;
    const bd = $('hudBadge'); bd.className = 'badge' + (r.active ? ' hot' : ''); bd.textContent = r.active ? `Raid ${r.n}` : `Next: raid ${r.n}`;
    $('hudStats').innerHTML = `<span title="Damage per hit">⚔ <b>${st.dmg}</b></span><span title="Damage reduction">⛨ <b>${Math.round(st.red * 100)}%</b></span><span title="Enemies slain by the village">☠ <b>${V.kills}</b></span>` +
      `<span class="sp${sp ? ' on' : ''}" id="hudSp" title="Skill points: spend them in Research > Hero training">✦ <b>${sp}</b></span>`;
    $('hudInc').innerHTML = `<span>${ICO.gold} <b>+${inc.g}</b>/min</span><span>${ICO.wood} <b>+${inc.w}</b>/min</span><span class="dif">${DIFF[SET.diff].name}</span>`;
  }
  // ability chips with cooldown sweeps
  const abil = [['hStrike', h ? h.strikeCd : 0, HERO_DEF.strikeCd, HERO_DEF.strikeMana, 0], ['hHeal', h ? h.healCd || 0 : 0, HERO_DEF.healCd, HERO_DEF.healMana, 0], ['hCry', h ? h.cryCd || 0 : 0, HERO_DEF.cryCd, HERO_DEF.cryMana, HERO_DEF.cryLevel]];
  for (const [id, cd, max, mana, lvl] of abil) {
    const el = $(id), locked = lvl > V.heroLevel, noMana = !locked && h && h.mana < mana, active = id === 'hCry' && h && h.cryT > 0;
    el.classList.toggle('locked', locked); el.classList.toggle('cool', cd > 0); el.classList.toggle('nomana', !!noMana && cd <= 0); el.classList.toggle('active', !!active);
    el.style.setProperty('--cd', cd > 0 ? (cd / max * 100) + '%' : '0%');
    el.querySelector('em').textContent = locked ? 'Lv' + lvl : cd > 0 ? Math.ceil(cd) : '';
  }
}
