/* Shared schedule engine for the Schedule and Team Info pages.
   Every week's games for every season:
   - 2022–2025 from data/history.json (snapshot of Sleeper matchups + brackets)
   - the current season live from Sleeper (/league/<id>/matchups/<week>, regular season only; playoff
     pairings are only shown once the season's brackets are final, since Sleeper pre-fills placeholder ones)
   Playoff weeks are built from the brackets, so every playoff / toilet-bowl game is labeled; a franchise is
   its Sleeper roster slot (roster_id), which carries across seasons via previous_league_id. */
const SCH_WINNER_LABEL = (m) => m.p === 1 ? "Championship" : m.p === 3 ? "3rd-place game" : m.p === 5 ? "5th-place game" : m.r === 1 ? "Playoffs · Round 1" : "Semifinal";
const SCH_LOSER_LABEL = (m) => m.p === 1 ? "Toilet Bowl final" : m.p === 3 ? "Toilet Bowl · 7th-place game" : "Toilet Bowl · Round 1";
const schTeamHref = (rid) => `team-info.html?team=${rid}`;
const schName = (S, rid) => S.owners[rid]?.team || `Team ${S.owners[rid]?.name || "?"}`;

function schGame(S, wk, a, b, ap, bp, extra = {}) {
  const status = extra.status || "final";
  let winner = null, tie = false;
  if (status === "final") {
    if (ap > bp) winner = a; else if (bp > ap) winner = b; else tie = true;
  }
  return { wk, a, b, ap, bp, status, winner, tie, kind: "reg", label: null, ...extra };
}

/* Build one season's schedule from rows of [roster_id, matchup_id, points] keyed by week */
function schBuildPast(s) {
  const W = s.playoff_week_start;
  const userById = Object.fromEntries(s.users.map((u) => [u.user_id, u]));
  const owners = Object.fromEntries(s.rosters.map((r) => { const u = userById[r.owner_id] || {}; return [r.roster_id, { name: u.display_name || "?", team: u.team_name, avatar: u.avatar }]; }));
  const S = { season: s.season, W, owners, complete: true, weeks: [] };
  const ptsOf = (wk, rid) => { const r = (s.matchups[wk] || []).find((x) => x[0] === rid); return r ? r[2] : null; };
  for (let wk = 1; wk < W; wk++) {
    const by = {};
    for (const r of s.matchups[wk] || []) if (r[1] != null) (by[r[1]] ||= []).push(r);
    const games = Object.values(by).filter((p) => p.length === 2).map(([x, y]) => schGame(S, wk, x[0], y[0], x[2], y[2]));
    S.weeks.push({ wk, playoff: false, games, byes: [] });
  }
  for (let r = 1; r <= 3; r++) {
    const wk = W + r - 1, games = [];
    for (const m of s.winners_bracket || []) if (m.r === r && m.t1 != null && m.t2 != null)
      games.push(schGame(S, wk, m.t1, m.t2, ptsOf(wk, m.t1), ptsOf(wk, m.t2), { kind: m.p === 1 || (m.p == null) ? "po" : "po-place", label: SCH_WINNER_LABEL(m), p: m.p }));
    for (const m of s.losers_bracket || []) if (m.r === r && m.t1 != null && m.t2 != null)
      games.push(schGame(S, wk, m.t1, m.t2, ptsOf(wk, m.t1), ptsOf(wk, m.t2), { kind: "tb", label: SCH_LOSER_LABEL(m), p: m.p }));
    // Ties in bracket games are broken by Sleeper (winners bracket only)
    for (const g of games) if (g.tie && g.kind !== "tb") { const m = s.winners_bracket.find((x) => x.r === r && [x.t1, x.t2].includes(g.a)); if (m?.w) { g.winner = m.w; g.tie = false; } }
    const order = { "po": 0, "po-place": 1, "tb": 2 };
    games.sort((x, y) => order[x.kind] - order[y.kind] || (x.p === 1 ? -1 : 0) - (y.p === 1 ? -1 : 0));
    // Round-1 byes: teams that enter the winners bracket in round 2 without a feeder game
    const byes = r === 1 ? (s.winners_bracket || []).filter((m) => m.r === 2 && m.p == null).flatMap((m) => [!m.t1_from ? m.t1 : null, !m.t2_from ? m.t2 : null]).filter((x) => x != null) : [];
    S.weeks.push({ wk, playoff: true, round: r, games, byes });
  }
  return S;
}

async function loadSchedules() {
  const [{ league, state, teams }, history] = await Promise.all([loadLeague(), loadHistory()]);
  const W = league.settings.playoff_week_start || 15;
  const regWeeks = Array.from({ length: W - 1 }, (_, i) => i + 1);
  const rows = await Promise.all(regWeeks.map((w) => sleeper(`/league/${LEAGUE_ID}/matchups/${w}`)));
  const inSeason = state.season === league.season && state.season_type === "regular";
  const liveWeek = league.status === "complete" ? 99 : inSeason ? state.week : (state.season > league.season ? 99 : 0);
  const owners = Object.fromEntries([...teams.values()].map((t) => [t.rosterId, { name: t.owner, team: t.teamName, avatar: t.avatar }]));
  const S = { season: league.season, W, owners, complete: false, liveWeek, weeks: [] };
  regWeeks.forEach((wk, i) => {
    const status = wk < liveWeek ? "final" : wk === liveWeek ? "live" : "upcoming";
    const games = pairUp(rows[i]).map(([x, y]) => schGame(S, wk, x.roster_id, y.roster_id, x.points || 0, y.points || 0, { status }));
    S.weeks.push({ wk, playoff: false, games, byes: [], status });
  });
  for (let r = 1; r <= 3; r++) S.weeks.push({ wk: W + r - 1, playoff: true, round: r, games: [], byes: [], status: "upcoming", tbd: true });

  const seasons = [S, ...history.seasons.map(schBuildPast)].sort((a, b) => b.season - a.season);
  for (const x of seasons) for (const w of x.weeks) if (!w.status) w.status = "final";

  /* ---- Special weeks: Rematch Week (1), Trade Deadline (settings.trade_deadline), Rivalry Week ---- */
  const cfg = await local("data/rivalries.json").catch(() => ({ week: 12, rivalries: [] }));
  const pastLeagues = await Promise.all(history.seasons.map((h) => sleeper(`/league/${h.league_id}`, { ttlMinutes: 720 }).catch(() => null)));
  const tdBySeason = { [league.season]: league.settings.trade_deadline };
  history.seasons.forEach((h, i) => { tdBySeason[h.season] = pastLeagues[i]?.settings?.trade_deadline; });
  const ridByOwner = Object.fromEntries(Object.entries(owners).map(([rid, o]) => [o.name.toLowerCase(), +rid]));
  const rivalries = (cfg.rivalries || []).map((r) => ({ name: r.name, rids: r.owners.map((u) => ridByOwner[String(u).toLowerCase()]) })).filter((r) => r.rids.every((x) => x != null));
  const pairKey = (a, b) => a < b ? `${a}-${b}` : `${b}-${a}`;
  const rivalByPair = Object.fromEntries(rivalries.map((r) => [pairKey(...r.rids), r]));
  // Every game ever, oldest first (regular season, playoffs, placement games and Toilet Bowl)
  const asc = [...seasons].sort((a, b) => a.season - b.season);
  const all = asc.flatMap((x) => x.weeks.flatMap((w) => w.games.map((g) => ({ g, S: x }))));
  const h2h = (a, b) => {
    const r = { aw: 0, bw: 0, t: 0, n: 0 };
    for (const { g } of all) if (g.status === "final" && pairKey(g.a, g.b) === pairKey(a, b)) {
      r.n++; if (g.tie) r.t++; else if (g.winner === a) r.aw++; else r.bw++;
    }
    return r;
  };
  for (const x of asc) {
    const td = tdBySeason[x.season] || 11;
    x.tradeDeadline = td;
    // Week 1: most recent previous meeting for every pairing
    const w1 = x.weeks.find((w) => w.wk === 1);
    for (const g of w1.games) {
      let last = null;
      for (const e of all) { if (e.S.season >= x.season) break; if (e.g.status === "final" && pairKey(e.g.a, e.g.b) === pairKey(g.a, g.b)) last = e; }
      g.lastMeet = last ? { season: last.S.season, wk: last.g.wk, label: last.g.label, S: last.S, g: last.g } : null;
    }
    // Rematch Week = every Week 1 game repeats both teams' final game of the previous season
    const prev = asc.find((p) => +p.season === +x.season - 1);
    let rematch = false;
    if (prev && w1.games.length) {
      const lastOpp = {};
      for (const w of prev.weeks) for (const g of w.games) { lastOpp[g.a] = { o: g.b, g, w }; lastOpp[g.b] = { o: g.a, g, w }; }
      rematch = w1.games.every((g) => lastOpp[g.a]?.o === g.b && lastOpp[g.b]?.o === g.a);
      if (rematch) for (const g of w1.games) g.rematchOf = lastOpp[g.a].g;
    }
    x.rematch = rematch;
    // Rivalry games in the configured week (matched by roster slot)
    const rw = x.weeks.find((w) => w.wk === (cfg.week || 12));
    let nRiv = 0;
    for (const g of rw?.games || []) {
      const r = rivalByPair[pairKey(g.a, g.b)];
      if (r) { nRiv++; const rec = h2h(g.a, g.b); g.rivalry = { name: r.name, rec }; }
    }
    x.rivalryCount = nRiv;
    for (const w of x.weeks) {
      w.special = [];
      if (w.wk === 1 && rematch) w.special.push({ type: "rematch", tag: "Rematch Week" });
      if (w.wk === td) w.special.push({ type: "deadline", tag: "Trade Deadline" });
      if (w === rw && nRiv) w.special.push({ type: "rivalry", tag: "Rivalry Week", count: nRiv, of: rivalries.length });
    }
  }
  // Default week to show: the live week during the season, otherwise the championship week
  const currentWeek = inSeason ? Math.min(Math.max(1, state.week), W + 2) : W + 2;
  return { league, state, teams, seasons, currentWeek, rivalries, rivalryWeek: cfg.week || 12 };
}

const schRoundName = (w) => !w.playoff ? `Week ${w.wk}` : `Week ${w.wk} · ${["Playoffs Round 1", "Semifinals", "Championship"][w.round - 1]}`;
const schStatusPill = (st) => st === "live" ? '<span class="pill live">Live</span>' : st === "upcoming" ? '<span class="pill">Upcoming</span>' : '<span class="pill final">Final</span>';

/* Special-week helpers shared by the Schedule and Team Info pages */
const SCH_SPECIAL_ICON = { rematch: "🔁", deadline: "🔒", rivalry: "⚔️" };
const schSpecialTags = (w) => (w.special || []).map((x) => `<span class="sp-tag ${x.type}">${SCH_SPECIAL_ICON[x.type]} ${x.tag}</span>`).join("");
const schSpecialClass = (w) => (w.special || []).map((x) => `sp-${x.type}`).join(" ");
function schSpecialBanners(S, w, state) {
  return (w.special || []).map((x) => {
    let title = x.tag, text = "";
    if (x.type === "rematch") text = `Every Week ${w.wk} matchup replays both teams' final game of ${+S.season - 1} (playoffs, placement games and Toilet Bowl included). Each card shows how that last meeting went.`;
    if (x.type === "deadline") {
      text = `Trades lock after Week ${S.tradeDeadline}.`;
      if (!S.complete && state && state.season === S.season && state.season_type === "regular") {
        const n = S.tradeDeadline - state.week;
        if (n > 0) text += ` That's ${n} week${n === 1 ? "" : "s"} from now (current week: ${state.week}).`;
        else if (n === 0) text += " That's this week: get deals done.";
        else text += " The deadline has passed.";
      }
    }
    if (x.type === "rivalry") text = x.count === x.of ? `All ${x.of} league rivalries square off this week. Card titles show the rivalry and the franchises' all-time head-to-head.` : `${x.count} of the ${x.of} league rivalries met this week (rivalries are matched by franchise). Rivalry cards show the all-time head-to-head.`;
    return `<div class="sp-banner ${x.type}"><span class="sp-ico">${SCH_SPECIAL_ICON[x.type]}</span><div><b>${title}</b><span>${text}</span></div></div>`;
  }).join("");
}
/* "A 6–3 B" style all-time series text, from side a's point of view */
const schSeries = (rec, aName, bName) => !rec.n ? "First-ever meeting" : rec.aw === rec.bw ? `All-time series tied ${rec.aw}–${rec.bw}${rec.t ? `–${rec.t}` : ""}` : `All-time: ${esc(rec.aw > rec.bw ? aName : bName)} leads ${Math.max(rec.aw, rec.bw)}–${Math.min(rec.aw, rec.bw)}${rec.t ? `–${rec.t}` : ""}`;
