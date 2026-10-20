// Party awards from stored data. Pure.
// rounds: [{ outcomes:[{userId,name,outAtT,peak}], winners:[userId] }]
// events: [{ userId, kind, strength, source }]   names: { userId: name }
export function computeAwards({ rounds = [], events = [], names = {} }) {
  const awards = [];
  const nm = (id) => names[id] || 'Someone';

  // First to crack: earliest outAtT across rounds.
  let first = null;
  for (const r of rounds) {
    for (const o of r.outcomes) {
      if (o.outAtT != null && (!first || o.outAtT < first.outAtT)) first = o;
    }
  }
  if (first) awards.push({ key: 'first-to-crack', title: 'First to crack', userId: String(first.userId), detail: `Out at ${Math.floor(first.outAtT)}s` });

  // Poker face champion: most round wins.
  const wins = {};
  for (const r of rounds) for (const w of r.winners) wins[String(w)] = (wins[String(w)] || 0) + 1;
  const champ = Object.entries(wins).sort((a, b) => b[1] - a[1])[0];
  if (champ) awards.push({ key: 'poker-face', title: 'Poker face champion', userId: champ[0], detail: `${champ[1]} round${champ[1] > 1 ? 's' : ''} won` });

  // Biggest laugh: highest strength laugh/smile event.
  const laughs = events.filter((e) => (e.kind === 'laugh' || e.kind === 'smile') && e.userId);
  const big = laughs.reduce((a, b) => (!a || b.strength > a.strength ? b : a), null);
  if (big) awards.push({ key: 'biggest-laugh', title: 'Biggest laugh', userId: String(big.userId), detail: `${Math.round(big.strength * 100)}% smile` });

  // Most shocked: most surprise events.
  const shock = {};
  for (const e of events) if (e.kind === 'surprise' && e.userId) shock[String(e.userId)] = (shock[String(e.userId)] || 0) + 1;
  const sh = Object.entries(shock).sort((a, b) => b[1] - a[1])[0];
  if (sh) awards.push({ key: 'most-shocked', title: 'Most shocked', userId: sh[0], detail: `${sh[1]} gasp${sh[1] > 1 ? 's' : ''}` });

  // Hype person: most manual emojis.
  const hype = {};
  for (const e of events) if (e.kind === 'emoji' && e.source === 'manual' && e.userId) hype[String(e.userId)] = (hype[String(e.userId)] || 0) + 1;
  const hp = Object.entries(hype).sort((a, b) => b[1] - a[1])[0];
  if (hp) awards.push({ key: 'hype-person', title: 'Hype person', userId: hp[0], detail: `${hp[1]} emoji${hp[1] > 1 ? 's' : ''}` });

  return awards.map((a) => ({ ...a, name: nm(a.userId) }));
}
