/* Shared league-history engine, used by History & Records and Team History.
   - Past seasons come from data/history.json (scripts/snapshot.py); the current season is merged in live.
   - "Franchise" = Sleeper roster slot (roster_id). It carries over season to season even when a team
     changes hands, so a former manager's seasons count for the franchise. Names are shown as the
     manager who actually played that season, with a "now @x" note when the slot has since changed hands. */

async function loadLeagueHistory() {
  const [{ league, state, teams, standings }, history, players] = await Promise.all([loadLeague(), loadHistory(), loadPlayers()]);
  const done = lastCompletedWeek(state, league);
  const cur = done ? await loadMatchups(done) : {};

  const seasons = history.seasons.map((s) => {
    const userById = Object.fromEntries(s.users.map((u) => [u.user_id, u]));
    const owners = Object.fromEntries(s.rosters.map((r) => {
      const u = userById[r.owner_id] || {};
      return [r.roster_id, { name: u.display_name || "?", team: u.team_name, avatar: u.avatar }];
    }));
    return { ...s, owners, complete: true };
  });

  // Current season: live standings + matchups; player games from each week's starters
  const liveHighs = [];
  for (const [w, rows] of Object.entries(cur)) for (const r of rows) {
    if (r.matchup_id == null) continue;
    (r.starters || []).forEach((pid, i) => {
      const pts = (r.starters_points || [])[i];
      if (!pid || pid === "0" || !pts) return;
      const p = players[pid] || {};
      liveHighs.push([+w, r.roster_id, pid, p.n || `Player ${pid}`, p.p || "", pts, 1]);
    });
  }
  seasons.unshift({
    season: league.season, league_id: LEAGUE_ID, complete: false,
    playoff_week_start: league.settings.playoff_week_start, playoff_teams: league.settings.playoff_teams,
    owners: Object.fromEntries([...teams.values()].map((t) => [t.rosterId, { name: t.owner, team: t.teamName, avatar: t.avatar }])),
    rosters: [...teams.values()].map((t) => ({ roster_id: t.rosterId, wins: t.wins, losses: t.losses, ties: t.ties, fpts: t.pf, fpts_against: t.pa })),
    matchups: Object.fromEntries(Object.entries(cur).map(([w, rows]) => [w, rows.map((r) => [r.roster_id, r.matchup_id, r.points || 0])])),
    winners_bracket: [], losers_bracket: [], player_highs: liveHighs,
  });
  seasons.sort((a, b) => b.season - a.season);

  const ctx = { league, state, teams, standings, done, seasons };
  Object.assign(ctx, buildGames(seasons));
  return ctx;
}

/* ---------- Small helpers ---------- */
const teamHref = (rid) => `team-history.html?team=${rid}`;
// Team name a franchise used in a given season (falls back like the live site does)
const seasonTeam = (s, rid) => s.owners[rid]?.team || `Team ${s.owners[rid]?.name || "?"}`;
// Manager that season, linked to the franchise page, plus "now @x" if the slot changed hands
function who(ctx, s, rid, { link = true } = {}) {
  const n = s.owners[rid]?.name || "?";
  const now = ctx.teams.get(rid)?.owner;
  const name = link ? `<a class="tlink" href="${teamHref(rid)}">${esc(n)}</a>` : esc(n);
  return `<b>${name}</b>${now && now !== n ? ` <span class="was">now @${esc(now)}</span>` : ""}`;
}
const winPct = (r) => (r.wins + r.ties / 2) / Math.max(1, r.wins + r.losses + r.ties);
const regRank = (s) => [...s.rosters].sort((a, b) => winPct(b) - winPct(a) || b.fpts - a.fpts);
// Playoff seeds aren't stored by Sleeper; they follow the standings (win %, then points for).
// Checked against every bracket: seeds 1-2 are always the bye teams.
const seedMap = (s) => Object.fromEntries(regRank(s).map((r, i) => [r.roster_id, i + 1]));

/* Final placements from the winners bracket (1st–6th); others by regular season */
function placements(s) {
  const place = {};
  for (const m of s.winners_bracket || []) {
    if (m.p === 1) { place[m.w] = 1; place[m.l] = 2; }
    if (m.p === 3) { place[m.w] = 3; place[m.l] = 4; }
    if (m.p === 5) { place[m.w] = 5; place[m.l] = 6; }
  }
  let next = 7;
  for (const r of regRank(s)) if (!place[r.roster_id]) place[r.roster_id] = next++;
  return place;
}
const finishLabel = (p) => p === 1 ? "🏆 Champion" : p === 2 ? "Runner-up" : p === 3 ? "3rd" : p <= 6 ? ord(p) + " (playoffs)" : ord(p);
const star = (s) => (s.season === "2022" ? "*" : "");
const wkTag = (x) => `${x.s.season}${star(x.s)} · Wk ${x.wk}${x.playoff ? " (P)" : ""}`;

/* Every real game and team score across all seasons (regular season, playoffs, consolation) */
function buildGames(seasons) {
  const games = [], scores = [];
  for (const s of seasons) {
    for (const [w, rows] of Object.entries(s.matchups)) {
      const wk = +w, playoff = wk >= s.playoff_week_start;
      const by = {};
      for (const r of rows) if (r[1] != null) (by[r[1]] ||= []).push(r);
      for (const pair of Object.values(by)) if (pair.length === 2) {
        const [a, b] = pair[0][2] >= pair[1][2] ? pair : [pair[1], pair[0]];
        const g = { s, wk, win: a, lose: b, margin: a[2] - b[2], playoff };
        games.push(g);
        scores.push({ s, wk, rid: a[0], pts: a[2], opp: b[0], oppPts: b[2], res: g.margin ? "W" : "T", playoff, g });
        scores.push({ s, wk, rid: b[0], pts: b[2], opp: a[0], oppPts: a[2], res: g.margin ? "L" : "T", playoff, g });
      }
    }
  }
  const seasonRows = seasons.filter((s) => s.complete).flatMap((s) => s.rosters.map((r) => ({ s, r })));
  const playerHighs = seasons.flatMap((s) => (s.player_highs || []).filter((p) => p[6]).map((p) => ({ s, wk: p[0], rid: p[1], name: p[3], pos: p[4], pts: p[5], playoff: p[0] >= s.playoff_week_start })));
  return { games, scores, seasonRows, playerHighs };
}

/* ---------- Record book ---------- */
const top10 = (arr, key, dir = -1) => [...arr].sort((a, b) => dir * (key(a) - key(b))).slice(0, 10);

/* Categories as { id, label, sub, head, rows: [[main, detail, value]] }. With rid, only that franchise's records. */
function recordCategories(ctx, rid = null) {
  const { scores, games, seasonRows, playerHighs, league, done } = ctx;
  const W = (s, r) => who(ctx, s, r, { link: rid == null });
  const opp = (s, r) => esc(seasonTeam(s, r));
  const score = (g) => `${fmt(g.win[2])}–${fmt(g.lose[2])}`;
  const vs = (g) => `${g.margin === 0 ? "tied" : "beat"} ${opp(g.s, g.lose[0])} ${score(g)} · ${wkTag(g)}`;
  const recLine = (x) => `${x.s.season}${star(x.s)} · ${recordStr(x.r.wins, x.r.losses, x.r.ties)}`;
  const mine = (x) => rid == null || x.rid === rid;
  const sc = scores.filter(mine);
  const scoreRow = (x) => [W(x.s, x.rid), `${x.res === "W" ? "W" : x.res === "L" ? "L" : "T"} vs ${opp(x.s, x.opp)} ${fmt(x.pts)}–${fmt(x.oppPts)} · ${wkTag(x)}`, fmt(x.pts)];
  const cats = [
    { id: "high", label: "Highest scores", sub: "Single week, any game", head: "Pts", rows: top10(sc, (x) => x.pts).map(scoreRow) },
    { id: "low", label: "Lowest scores", sub: "Single week, any game", head: "Pts", rows: top10(sc, (x) => x.pts, 1).map(scoreRow) },
  ];
  if (rid == null) {
    cats.push({ id: "blowouts", label: "Biggest blowouts", sub: "Margin of victory", head: "Margin", rows: top10(games, (g) => g.margin).map((g) => [W(g.s, g.win[0]), vs(g), fmt(g.margin)]) });
    cats.push({ id: "close", label: "Closest games", sub: "Nail-biters (ties count)", head: "Margin", rows: top10(games, (g) => g.margin, 1).map((g) => [W(g.s, g.win[0]), vs(g), fmt(g.margin)]) });
  } else {
    const wins = sc.filter((x) => x.res === "W"), losses = sc.filter((x) => x.res === "L");
    cats.push({ id: "blowouts", label: "Biggest wins", sub: "Margin of victory", head: "Margin", rows: top10(wins, (x) => x.pts - x.oppPts).map((x) => [W(x.s, rid), `beat ${opp(x.s, x.opp)} ${fmt(x.pts)}–${fmt(x.oppPts)} · ${wkTag(x)}`, fmt(x.pts - x.oppPts)]) });
    cats.push({ id: "worst", label: "Worst losses", sub: "Margin of defeat", head: "Margin", rows: top10(losses, (x) => x.oppPts - x.pts).map((x) => [W(x.s, rid), `lost to ${opp(x.s, x.opp)} ${fmt(x.pts)}–${fmt(x.oppPts)} · ${wkTag(x)}`, fmt(x.oppPts - x.pts)]) });
    const close = top10(sc, (x) => Math.abs(x.pts - x.oppPts), 1);
    cats.push({ id: "close", label: "Closest games", sub: "Nail-biters, won or lost", head: "Margin", rows: close.map((x) => { const r = scoreRow(x); return [r[0], r[1], fmt(Math.abs(x.pts - x.oppPts))]; }) });
  }
  const realWins = games.filter((g) => g.margin > 0);
  cats.push({ id: "hiloss", label: "Highest-scoring losses", sub: "Heartbreak hall of fame", head: "Pts",
    rows: top10(realWins.filter((g) => rid == null || g.lose[0] === rid), (g) => g.lose[2]).map((g) => [W(g.s, g.lose[0]), `lost to ${opp(g.s, g.win[0])} ${fmt(g.lose[2])}–${fmt(g.win[2])} · ${wkTag(g)}`, fmt(g.lose[2])]) });
  cats.push({ id: "lowwin", label: "Lowest-scoring wins", sub: "Ugly but it counts", head: "Pts",
    rows: top10(realWins.filter((g) => rid == null || g.win[0] === rid), (g) => g.win[2], 1).map((g) => [W(g.s, g.win[0]), vs(g), fmt(g.win[2])]) });
  const sr = seasonRows.filter((x) => rid == null || x.r.roster_id === rid);
  cats.push({ id: "mostpf", label: rid == null ? "Most season points" : "Best season PF", sub: "Regular season, completed seasons", head: "PF", rows: top10(sr, (x) => x.r.fpts).map((x) => [W(x.s, x.r.roster_id), recLine(x), fmt(x.r.fpts)]) });
  cats.push({ id: "fewpf", label: rid == null ? "Fewest season points" : "Worst season PF", sub: "Regular season, completed seasons", head: "PF", rows: top10(sr, (x) => x.r.fpts, 1).map((x) => [W(x.s, x.r.roster_id), recLine(x), fmt(x.r.fpts)]) });
  cats.push({ id: "players", label: "Player single-game highs", sub: `Starters only, 2022–${league.season}`, head: "Pts",
    rows: top10(playerHighs.filter(mine), (x) => x.pts).map((x) => [`<b>${esc(x.name)}</b> <span class="muted small">${esc(x.pos || "")}</span>`, `for ${rid == null ? who(ctx, x.s, x.rid) : esc(seasonTeam(x.s, x.rid))} · ${wkTag(x)}`, fmt(x.pts)]) });
  return cats;
}

const recordNote = (ctx) => `Weekly records include every game with a real opponent: regular season, playoffs, and consolation games; “(P)” marks a playoff week. Week 18 is excluded because there are no matchups. *2022: defensive scoring was reduced after the 2022 season, so 2022 point totals run high (charter §9.1).${ctx.done ? ` ${ctx.league.season} games through Week ${ctx.done} are included live.` : ""}`;

/* One panel with a category picker: pill tabs on desktop, a dropdown on phones */
function renderRecordBook(el, cats, note) {
  el.innerHTML = `<div class="recbook-nav">
      <div class="tabs recbook-tabs" role="tablist">${cats.map((c) => `<button data-id="${c.id}" role="tab">${esc(c.label)}</button>`).join("")}</div>
      <label class="recbook-pick"><span class="muted small">Category</span>
        <select class="select">${cats.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("")}</select></label>
    </div>
    <div class="recbook-body"></div>${note ? `<p class="note">${note}</p>` : ""}`;
  const body = el.querySelector(".recbook-body"), sel = el.querySelector("select");
  const show = (id) => {
    const c = cats.find((x) => x.id === id) || cats[0];
    el.querySelectorAll(".recbook-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.id === c.id));
    sel.value = c.id;
    body.innerHTML = `<div class="recbook-head"><h3>${esc(c.label)}</h3><span class="muted small">${c.sub} · Top ${Math.min(10, c.rows.length)}</span></div>
      ${c.rows.length ? `<div class="table-wrap"><table class="rec-table"><thead><tr><th></th><th>${c.id === "players" ? "Player" : "Manager"}</th><th class="rb-detail">Details</th><th class="num">${c.head}</th></tr></thead><tbody>
      ${c.rows.map(([main, line, val], i) => `<tr><td class="rank">${i < 3 ? `<span class="medal ${"gsb"[i]}">${i + 1}</span>` : i + 1}</td>
        <td>${main}<div class="muted small rb-sub">${line}</div></td><td class="muted small rb-detail">${line}</td><td class="num"><b>${val}</b></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">No games yet.</p>`}`;
  };
  el.querySelectorAll(".recbook-tabs button").forEach((b) => (b.onclick = () => show(b.dataset.id)));
  sel.onchange = () => show(sel.value);
  show(cats[0].id);
}

/* ---------- Playoff brackets ---------- */
/* Sleeper bracket rows: { r: round, m: match id, t1, t2, w, l, p: placement game (1 = final, 3 = 3rd, 5 = 5th),
   t1_from / t2_from: { w: m } or { l: m } }. Round r is played in week playoff_week_start + r - 1.
   In this league the losers bracket is a toilet bowl: Sleeper advances the LOSER of each game, and the
   bracket's "w" field is the team that advanced (i.e. the one that actually lost on the scoreboard).
   So every box here is highlighted by the real scores, not by Sleeper's w/l. */
function renderBracket(ctx, s, kind = "winners") {
  const seeds = seedMap(s);
  const B = (kind === "winners" ? s.winners_bracket : s.losers_bracket) || [];
  if (!B.length) return `<p class="muted">No bracket for ${s.season} yet.</p>`;
  const week = (m) => s.playoff_week_start + m.r - 1;
  const pts = (m, rid) => { const r = (s.matchups[week(m)] || []).find((x) => x[0] === rid); return r ? r[2] : null; };
  const byM = Object.fromEntries(B.map((m) => [m.m, m]));
  const fromLabel = (f) => f ? `${f.w != null ? "Winner" : "Loser"} of game ${f.w ?? f.l}` : "TBD";
  const winnerOf = (m) => {
    const a = pts(m, m.t1), b = pts(m, m.t2);
    if (a != null && b != null && (a || b)) return a > b ? m.t1 : b > a ? m.t2 : null;
    return kind === "winners" ? m.w ?? null : null;
  };
  const row = (rid, score, state, fallback) => rid == null
    ? `<div class="bk-team tbd"><span class="bk-seed"></span><span class="bk-name">${esc(fallback)}</span><span class="bk-score">–</span></div>`
    : `<div class="bk-team ${state}"><span class="bk-seed">${seeds[rid] ?? ""}</span><img class="avatar" src="${avatarUrl(s.owners[rid]?.avatar)}" alt="" loading="lazy">
        <span class="bk-name"><a class="tlink" href="${teamHref(rid)}">${esc(seasonTeam(s, rid))}</a><small>@${esc(s.owners[rid]?.name || "?")}</small></span>
        <span class="bk-score">${score == null ? "–" : fmt(score)}</span></div>`;
  const match = (m, label, cls = "") => {
    if (!m) return "";
    const win = winnerOf(m);
    const st = (rid) => (win == null || rid == null ? "" : rid === win ? "win" : "lose");
    return `<div class="bk-match ${cls}">${label ? `<div class="bk-label">${label}</div>` : ""}
      ${row(m.t1, pts(m, m.t1), st(m.t1), fromLabel(m.t1_from))}${row(m.t2, pts(m, m.t2), st(m.t2), fromLabel(m.t2_from))}</div>`;
  };
  const bye = (rid) => `<div class="bk-match bk-bye"><div class="bk-label">Bye · Wk ${s.playoff_week_start}</div>${row(rid, null, "", "TBD").replace('<span class="bk-score">–</span>', '<span class="bk-score bye">BYE</span>')}</div>`;
  const cell = (inner, cls) => `<div class="bk-cell ${cls}">${inner}</div>`;
  const W = s.playoff_week_start;

  if (kind === "winners") {
    const r1 = B.filter((m) => m.r === 1), semis = B.filter((m) => m.r === 2 && m.p == null);
    const final = B.find((m) => m.p === 1), third = B.find((m) => m.p === 3), fifth = B.find((m) => m.p === 5);
    // Each semifinal = a bye team + the winner of a round-1 game; order semis by the bye team's seed
    const parts = semis.map((m) => {
      const feed = [m.t1_from, m.t2_from].find((f) => f && f.w != null);
      const byeTeam = feed === m.t1_from ? m.t2 : m.t1;
      return { m, byeTeam, r1: byM[feed?.w] };
    }).sort((a, b) => (seeds[a.byeTeam] ?? 9) - (seeds[b.byeTeam] ?? 9));
    const used = new Set(parts.map((p) => p.r1?.m));
    r1.filter((m) => !used.has(m.m)).forEach((m) => parts.push({ m: null, byeTeam: null, r1: m }));
    const champ = final ? winnerOf(final) : null;
    const runner = champ != null ? (champ === final.t1 ? final.t2 : final.t1) : null;
    const champBox = champ != null
      ? `<div class="bk-champ"><div class="bk-trophy">🏆</div><div class="bk-champ-k">${s.season} Champion</div>
          <img class="avatar lg" src="${avatarUrl(s.owners[champ]?.avatar)}" alt="" loading="lazy">
          <div class="bk-champ-name"><a class="tlink" href="${teamHref(champ)}">${esc(seasonTeam(s, champ))}</a></div>
          <div class="muted small">@${esc(s.owners[champ]?.name)} · No. ${seeds[champ]} seed</div>
          <div class="small bk-champ-score">def. ${esc(seasonTeam(s, runner))}<br><b>${fmt(pts(final, champ))}–${fmt(pts(final, runner))}</b></div></div>`
      : `<div class="bk-champ tbd"><div class="bk-trophy">🏆</div><div class="bk-champ-k">${s.season} Champion</div><div class="muted">TBD</div></div>`;
    let col1 = "", col2 = "";
    parts.forEach((p, i) => {
      const r = i * 2 + 1;
      col1 += cell(p.byeTeam != null ? bye(p.byeTeam) : "", `c1 ${p.byeTeam != null ? "feed" : ""}" style="grid-row:${r}`);
      col1 += cell(match(p.r1, `Game ${p.r1?.m} · Wk ${W}`, "bk-out"), `c1 feed" style="grid-row:${r + 1}`);
      col2 += cell(match(p.m, p.m ? `Semifinal · Wk ${W + 1}` : "", "bk-out"), `c2 join" style="grid-row:${r}/span 2`);
    });
    return `<div class="bk-scroll"><div class="bk-grid bk-w">
        <div class="bk-round" style="grid-column:1">Round 1 · Wk ${W}</div><div class="bk-round" style="grid-column:2">Semifinals · Wk ${W + 1}</div>
        <div class="bk-round" style="grid-column:3">Championship · Wk ${W + 2}</div><div class="bk-round" style="grid-column:4">Champion</div>
        <div class="bk-col" style="grid-column:1">${col1}</div><div class="bk-col" style="grid-column:2">${col2}</div>
        <div class="bk-col" style="grid-column:3">${cell(match(final, `Final · Wk ${W + 2}`, "bk-final bk-out"), 'c3 join" style="grid-row:1/span 4')}</div>
        <div class="bk-col" style="grid-column:4">${cell(champBox, 'c4 join1" style="grid-row:1/span 4')}</div>
      </div>
      <div class="bk-extra">${match(third, `🥉 3rd-place game · Wk ${W + 2}`)}${match(fifth, `5th-place game · Wk ${W + 1}`)}</div></div>`;
  }

  // Toilet bowl (losers bracket): round 1 in week W, then the "final" and the 7th-place game in week W+1
  const r1 = B.filter((m) => m.r === 1), tFinal = B.find((m) => m.p === 1), seventh = B.find((m) => m.p === 3);
  const lastPlace = tFinal ? (() => { const w = winnerOf(tFinal); return w == null ? null : w === tFinal.t1 ? tFinal.t2 : tFinal.t1; })() : null;
  const col1 = r1.map((m, i) => cell(match(m, `Game ${m.m} · Wk ${W}`, "bk-out"), `c1 feed" style="grid-row:${i + 1}`)).join("");
  const lastBox = lastPlace != null
    ? `<div class="bk-champ toilet"><div class="bk-trophy">🚽</div><div class="bk-champ-k">Toilet Bowl “winner”</div>
        <img class="avatar lg" src="${avatarUrl(s.owners[lastPlace]?.avatar)}" alt="" loading="lazy">
        <div class="bk-champ-name"><a class="tlink" href="${teamHref(lastPlace)}">${esc(seasonTeam(s, lastPlace))}</a></div>
        <div class="muted small">@${esc(s.owners[lastPlace]?.name)} · lost the final</div></div>`
    : `<div class="bk-champ toilet tbd"><div class="bk-trophy">🚽</div><div class="bk-champ-k">Toilet Bowl</div><div class="muted">TBD</div></div>`;
  return `<div class="bk-scroll"><div class="bk-grid bk-l">
      <div class="bk-round" style="grid-column:1">Round 1 · Wk ${W}</div><div class="bk-round" style="grid-column:2">Toilet Bowl final · Wk ${W + 1}</div><div class="bk-round" style="grid-column:3">Bottom of the bowl</div>
      <div class="bk-col bk-col2r" style="grid-column:1">${col1}</div>
      <div class="bk-col bk-col2r" style="grid-column:2">${cell(match(tFinal, `Losers of round 1 · Wk ${W + 1}`, "bk-out"), 'c2 join" style="grid-row:1/span 2')}</div>
      <div class="bk-col bk-col2r" style="grid-column:3">${cell(lastBox, 'c3 join1" style="grid-row:1/span 2')}</div>
    </div>
    <div class="bk-extra">${match(seventh, `7th-place game (winners of round 1) · Wk ${W + 1}`)}</div></div>`;
}
