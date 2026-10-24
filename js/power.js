/* Power Rankings: a transparent formula computed from real weekly scores.
   Power score (0-100) = 40% all-play win% + 30% actual win% + 30% points-for index
   - All-play: every week, each team is compared against all 9 other scores.
   - PF index: a team's total points divided by the league's best total.
   Movement arrows compare with the same formula run through the previous week. */
const W_ALLPLAY = 0.4, W_RECORD = 0.3, W_PF = 0.3;

function computePower(teamIds, weeks) {
  const s = Object.fromEntries(teamIds.map((id) => [id, { id, w: 0, l: 0, t: 0, apW: 0, apL: 0, apT: 0, pf: 0, scores: [] }]));
  for (const rows of weeks) {
    const scored = rows.filter((r) => r.matchup_id != null);
    for (const r of scored) {
      const me = s[r.roster_id]; if (!me) continue;
      me.pf += r.points || 0; me.scores.push(r.points || 0);
      for (const o of scored) if (o !== r) {
        if (r.points > o.points) me.apW++; else if (r.points < o.points) me.apL++; else me.apT++;
      }
    }
    for (const [a, b] of pairUp(scored)) {
      if (a.points > b.points) { s[a.roster_id].w++; s[b.roster_id].l++; }
      else if (a.points < b.points) { s[b.roster_id].w++; s[a.roster_id].l++; }
      else { s[a.roster_id].t++; s[b.roster_id].t++; }
    }
  }
  const list = Object.values(s);
  const maxPf = Math.max(...list.map((x) => x.pf), 1);
  for (const x of list) {
    const g = x.w + x.l + x.t, ag = x.apW + x.apL + x.apT;
    x.winPct = g ? (x.w + x.t / 2) / g : 0;
    x.apPct = ag ? (x.apW + x.apT / 2) / ag : 0;
    x.pfIdx = x.pf / maxPf;
    x.power = 100 * (W_ALLPLAY * x.apPct + W_RECORD * x.winPct + W_PF * x.pfIdx);
    const last3 = x.scores.slice(-3);
    x.last3 = last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : 0;
  }
  return list.sort((a, b) => b.power - a.power || b.pf - a.pf);
}

boot(async () => {
  const { league, state, teams } = await loadLeague();
  const done = lastCompletedWeek(state, league);
  if (!done) { $("#power").innerHTML = `<p class="muted">Rankings appear once Week 1 is complete.</p>`; return; }
  const m = await loadMatchups(done);
  const weeks = Object.keys(m).sort((a, b) => a - b).map((w) => m[w]);
  const ids = [...teams.keys()];
  const now = computePower(ids, weeks);
  const prev = done > 1 ? computePower(ids, weeks.slice(0, -1)) : null;
  const prevRank = prev ? Object.fromEntries(prev.map((x, i) => [x.id, i + 1])) : {};

  $("#pr-sub").textContent = `Through Week ${done} of the ${league.season} season. Updates automatically every week.`;
  const top = now[0].power;
  $("#power").innerHTML = `<div class="pr-row header"><span>Rank</span><span>Team</span><span class="num">Record</span><span class="num">All-play</span><span class="num hide-sm">PF</span><span class="num hide-sm">Last 3 avg</span><span class="hide-sm">Power score</span></div>` +
    now.map((x, i) => {
      const t = teams.get(x.id);
      const mv = prev ? prevRank[x.id] - (i + 1) : 0;
      const move = !prev ? "" : mv > 0 ? `<div class="pr-move up">▲ ${mv}</div>` : mv < 0 ? `<div class="pr-move down">▼ ${-mv}</div>` : `<div class="pr-move same">–</div>`;
      return `<div class="pr-row ${t.isMe ? "me" : ""}">
        <div><div class="pr-rank">${i + 1}</div>${move}</div>
        <div>${teamChip(t, { link: true })}</div>
        <div class="num"><b>${recordStr(x.w, x.l, x.t)}</b></div>
        <div class="num">${recordStr(x.apW, x.apL, x.apT)}<div class="muted small">${pct(x.apPct)}</div></div>
        <div class="num hide-sm">${fmt(x.pf, 1)}</div>
        <div class="num hide-sm">${fmt(x.last3, 1)}</div>
        <div class="hide-sm"><div class="bar"><i style="width:${(x.power / top) * 100}%"></i></div><div class="muted small" style="margin-top:4px">${x.power.toFixed(1)}</div></div>
      </div>`;
    }).join("");
  $("#pr-method").innerHTML = `<b>How it works:</b> Power score = 40% all-play win % (your score vs. all 9 other teams each week) + 30% actual win % + 30% points-for index (your PF ÷ the league's best PF). Arrows compare with last week's ranking. Records here are recalculated from weekly matchup scores.`;
  $("#updated").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
});
