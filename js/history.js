/* History & Record Book
   - Past seasons come from data/history.json (snapshotted by scripts/snapshot.py,
     following previous_league_id back to the 2022 startup league).
   - The current season is pulled live and merged into the records.
   - "Franchise" = Sleeper roster slot (roster_id), which carries over season to season even
     when a team changes hands. Names shown are the manager who actually played that season;
     a small "now @x" note appears when the franchise has since changed hands. */

boot(async () => {
  const [{ league, state, teams, standings }, history] = await Promise.all([loadLeague(), loadHistory()]);
  const done = lastCompletedWeek(state, league);
  const cur = done ? await loadMatchups(done) : {};

  /* ---- Normalise every season into one shape ---- */
  const seasons = history.seasons.map((s) => {
    const userById = Object.fromEntries(s.users.map((u) => [u.user_id, u]));
    const owners = Object.fromEntries(s.rosters.map((r) => {
      const u = userById[r.owner_id] || {};
      return [r.roster_id, { name: u.display_name || "?", team: u.team_name, avatar: u.avatar }];
    }));
    return { ...s, owners, complete: true };
  });
  seasons.unshift({
    season: league.season, complete: false, playoff_week_start: league.settings.playoff_week_start,
    owners: Object.fromEntries([...teams.values()].map((t) => [t.rosterId, { name: t.owner, team: t.teamName, avatar: t.avatar }])),
    rosters: [...teams.values()].map((t) => ({ roster_id: t.rosterId, wins: t.wins, losses: t.losses, ties: t.ties, fpts: t.pf, fpts_against: t.pa })),
    matchups: Object.fromEntries(Object.entries(cur).map(([w, rows]) => [w, rows.map((r) => [r.roster_id, r.matchup_id, r.points || 0])])),
    winners_bracket: [], player_highs: [],
  });
  seasons.sort((a, b) => b.season - a.season);

  const nowOwner = (rid) => teams.get(rid)?.owner;
  // "Name" plus a "now @x" hint when the franchise has changed hands since
  const who = (s, rid) => {
    const n = s.owners[rid]?.name || "?";
    const now = nowOwner(rid);
    return `<b>${esc(n)}</b>${now && now !== n ? ` <span class="was">now @${esc(now)}</span>` : ""}`;
  };
  const regRank = (s) => [...s.rosters].sort((a, b) => {
    const wp = (r) => (r.wins + r.ties / 2) / Math.max(1, r.wins + r.losses + r.ties);
    return wp(b) - wp(a) || b.fpts - a.fpts;
  });

  /* Final placements from the winners bracket (1st–6th); others by regular season */
  function placements(s) {
    const place = {};
    for (const m of s.winners_bracket) {
      if (m.p === 1) { place[m.w] = 1; place[m.l] = 2; }
      if (m.p === 3) { place[m.w] = 3; place[m.l] = 4; }
      if (m.p === 5) { place[m.w] = 5; place[m.l] = 6; }
    }
    let next = 7;
    for (const r of regRank(s)) if (!place[r.roster_id]) place[r.roster_id] = next++;
    return place;
  }

  /* ---- Trophy case ---- */
  $("#trophies").innerHTML = seasons.map((s) => {
    const reg = regRank(s), mostPf = [...s.rosters].sort((a, b) => b.fpts - a.fpts)[0];
    if (!s.complete) {
      const lead = reg[0];
      return `<div class="card season-card"><div class="year">${s.season}</div><span class="pill live">In progress</span>
        <div class="champ">Champion: TBD</div>
        <dl><dt>Current leader</dt><dd>${who(s, lead.roster_id)} (${recordStr(lead.wins, lead.losses, lead.ties)})</dd>
        <dt>PF leader</dt><dd>${who(s, mostPf.roster_id)} (${fmt(mostPf.fpts)})</dd>
        <dt>Playoffs</dt><dd>Week ${s.playoff_week_start}</dd></dl></div>`;
    }
    const final = s.winners_bracket.find((m) => m.p === 1), third = s.winners_bracket.find((m) => m.p === 3);
    return `<div class="card season-card"><span class="trophy">🏆</span><div class="year">${s.season}</div>
      <div class="champ">${who(s, final.w)}</div><div class="muted small">${esc(s.owners[final.w]?.team || "")}</div>
      <dl><dt><span class="medal s">2</span> Runner-up</dt><dd>${who(s, final.l)}</dd>
      <dt><span class="medal b">3</span> Third</dt><dd>${third ? who(s, third.w) : "–"}</dd>
      <dt>Reg. season champ</dt><dd>${who(s, reg[0].roster_id)} (${recordStr(reg[0].wins, reg[0].losses, reg[0].ties)})</dd>
      <dt>Most points for</dt><dd>${who(s, mostPf.roster_id)} (${fmt(mostPf.fpts)})</dd></dl></div>`;
  }).join("");

  /* ---- All-time regular season records per franchise ---- */
  const fr = {};
  for (const s of seasons) {
    const place = s.complete ? placements(s) : {};
    for (const r of s.rosters) {
      const f = (fr[r.roster_id] ||= { rid: r.roster_id, w: 0, l: 0, t: 0, pf: 0, seasons: 0, titles: 0, names: new Set() });
      f.w += r.wins; f.l += r.losses; f.t += r.ties; f.pf += r.fpts; f.seasons++;
      f.names.add(s.owners[r.roster_id]?.name);
      if (place[r.roster_id] === 1) f.titles++;
    }
  }
  const alltime = Object.values(fr).sort((a, b) => (b.w + b.t / 2) / (b.w + b.l + b.t) - (a.w + a.t / 2) / (a.w + a.l + a.t));
  $("#alltime").innerHTML = `<table><thead><tr><th>Franchise</th><th class="num">W-L-T</th><th class="num">Win %</th><th class="num hide-xs">Total PF</th><th class="num">🏆</th></tr></thead><tbody>
    ${alltime.map((f) => {
      const t = teams.get(f.rid);
      const prior = [...f.names].filter((n) => n && n !== t.owner);
      return `<tr class="${t.isMe ? "me" : ""}"><td>${teamChip(t, { sub: "@" + esc(t.owner) + (prior.length ? ` · was ${prior.map(esc).join(", ")}` : "") })}</td>
      <td class="num"><b>${f.w}-${f.l}-${f.t}</b></td><td class="num">${pct((f.w + f.t / 2) / (f.w + f.l + f.t))}</td>
      <td class="num hide-xs muted">${fmt(f.pf, 0)}</td><td class="num">${f.titles ? "🏆".repeat(f.titles) : ""}</td></tr>`;
    }).join("")}</tbody></table>
    <p class="note">${seasons.length} seasons (${seasons.filter((s) => s.complete).length} complete + ${league.season} so far). Regular season only.</p>`;

  /* ---- Playoff résumés (championship bracket only; 3rd/5th place games excluded) ---- */
  const po = {};
  for (const s of seasons.filter((x) => x.complete)) {
    const inBracket = new Set();
    for (const m of s.winners_bracket) {
      if (m.p != null && m.p !== 1) continue;
      [m.t1, m.t2].forEach((x) => typeof x === "number" && inBracket.add(x));
      const W = (po[m.w] ||= { rid: m.w, app: 0, w: 0, l: 0, ca: 0, c: 0 }), L = (po[m.l] ||= { rid: m.l, app: 0, w: 0, l: 0, ca: 0, c: 0 });
      W.w++; L.l++;
      if (m.p === 1) { W.ca++; L.ca++; W.c++; }
    }
    for (const rid of inBracket) (po[rid] ||= { rid, app: 0, w: 0, l: 0, ca: 0, c: 0 }).app++;
  }
  const poList = Object.values(po).sort((a, b) => b.c - a.c || b.ca - a.ca || b.w - a.w || a.l - b.l || b.app - a.app);
  $("#playoffs").innerHTML = `<table><thead><tr><th>Franchise</th><th class="num">Apps</th><th class="num">W-L</th><th class="num">Finals</th><th class="num">Titles</th></tr></thead><tbody>
    ${poList.map((p) => { const t = teams.get(p.rid); return `<tr class="${t.isMe ? "me" : ""}"><td>${teamChip(t)}</td><td class="num">${p.app}</td><td class="num"><b>${p.w}-${p.l}</b></td><td class="num">${p.ca}</td><td class="num">${p.c ? "🏆".repeat(p.c) : "–"}</td></tr>`; }).join("")}
    </tbody></table><p class="note">Sorted by championships, then finals appearances, wins, losses, and appearances (same order as the charter). Results are credited to the franchise (roster slot).</p>`;

  /* ---- Record book ---- */
  const games = [], scores = [];
  for (const s of seasons) {
    for (const [w, rows] of Object.entries(s.matchups)) {
      const wk = +w, playoff = wk >= s.playoff_week_start;
      const real = rows.filter((r) => r[1] != null);
      for (const r of real) scores.push({ s, wk, rid: r[0], pts: r[2], playoff });
      const by = {};
      for (const r of real) (by[r[1]] ||= []).push(r);
      for (const pair of Object.values(by)) if (pair.length === 2) {
        const [a, b] = pair[0][2] >= pair[1][2] ? pair : [pair[1], pair[0]];
        games.push({ s, wk, win: a, lose: b, margin: a[2] - b[2], playoff });
      }
    }
  }
  const wkTag = (x) => `${x.s.season} · Wk ${x.wk}${x.playoff ? " (P)" : ""}`;
  const top10 = (arr, key, dir = -1) => [...arr].sort((a, b) => dir * (key(a) - key(b))).slice(0, 10);
  // A compact top-10 card: each row = [main label, sub line, value]
  const card = (title, sub, valueHead, rows) => `<div class="card rec-card"><h2>${title}</h2><div class="muted small" style="margin:-8px 0 8px">${sub}</div>
    <table><thead><tr><th></th><th></th><th class="num">${valueHead}</th></tr></thead><tbody>
    ${rows.map(([main, line, val], i) => `<tr><td class="rank">${i + 1}</td><td>${main}<div class="muted small">${line}</div></td><td class="num"><b>${val}</b></td></tr>`).join("")}</tbody></table></div>`;

  const seasonRows = seasons.filter((s) => s.complete).flatMap((s) => s.rosters.map((r) => ({ s, r })));
  const star = (s) => (s.season === "2022" ? "*" : "");
  const playerHighs = seasons.flatMap((s) => (s.player_highs || []).filter((p) => p[6]).map((p) => ({ s, wk: p[0], rid: p[1], name: p[3], pos: p[4], pts: p[5], playoff: p[0] >= s.playoff_week_start })));

  const vs = (g) => `${g.margin === 0 ? "tied with" : "over"} ${esc(g.s.owners[g.lose[0]]?.name)} ${fmt(g.win[2])}–${fmt(g.lose[2])} · ${wkTag(g)}`;
  $("#records").innerHTML = [
    card("Highest Scores", "Single week, any game", "Pts", top10(scores, (x) => x.pts).map((x) => [who(x.s, x.rid), wkTag(x), fmt(x.pts)])),
    card("Lowest Scores", "Single week, any game", "Pts", top10(scores, (x) => x.pts, 1).map((x) => [who(x.s, x.rid), wkTag(x), fmt(x.pts)])),
    card("Biggest Blowouts", "Margin of victory", "Margin", top10(games, (g) => g.margin).map((g) => [who(g.s, g.win[0]), vs(g), fmt(g.margin)])),
    card("Closest Games", "Nail-biters (ties count)", "Margin", top10(games, (g) => g.margin, 1).map((g) => [who(g.s, g.win[0]), vs(g), fmt(g.margin)])),
    card("Highest-Scoring Losses", "Heartbreak hall of fame", "Pts", top10(games.filter((g) => g.margin > 0), (g) => g.lose[2]).map((g) => [who(g.s, g.lose[0]), `lost to ${esc(g.s.owners[g.win[0]]?.name)} · ${wkTag(g)}`, fmt(g.lose[2])])),
    card("Lowest-Scoring Wins", "Ugly but it counts", "Pts", top10(games.filter((g) => g.margin > 0), (g) => g.win[2], 1).map((g) => [who(g.s, g.win[0]), vs(g), fmt(g.win[2])])),
    card("Most Points, Season", "Regular season, completed seasons", "PF", top10(seasonRows, (x) => x.r.fpts).map((x) => [who(x.s, x.r.roster_id), `${x.s.season}${star(x.s)} · ${recordStr(x.r.wins, x.r.losses, x.r.ties)}`, fmt(x.r.fpts)])),
    card("Fewest Points, Season", "Regular season, completed seasons", "PF", top10(seasonRows, (x) => x.r.fpts, 1).map((x) => [who(x.s, x.r.roster_id), `${x.s.season}${star(x.s)} · ${recordStr(x.r.wins, x.r.losses, x.r.ties)}`, fmt(x.r.fpts)])),
    card("Player Single-Game Highs", "Starters only, 2022–2025", "Pts", top10(playerHighs, (x) => x.pts).map((x) => [`<b>${esc(x.name)}</b> <span class="muted small">${esc(x.pos || "")}</span>`, `for ${esc(x.s.owners[x.rid]?.name)} · ${wkTag(x)}`, fmt(x.pts)])),
  ].join("") + `<p class="note" style="grid-column:1/-1">Weekly records include every game with a real opponent: regular season, playoffs, and consolation games ((P) = playoff week). Week 18 is excluded because there are no matchups. *2022: defensive scoring was reduced after the 2022 season, so 2022 point totals run high (charter §9.1). ${league.season} games through Week ${done} are included live.</p>`;

  /* ---- Final standings by season (tabs) ---- */
  const showSeason = (s) => {
    document.querySelectorAll("#season-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.s === s.season));
    const place = s.complete ? placements(s) : null;
    const reg = regRank(s);
    const finishLabel = (p) => p === 1 ? "🏆 Champion" : p === 2 ? "Runner-up" : p === 3 ? "3rd" : p <= 6 ? ord(p) + " (playoffs)" : ord(p);
    const order = place ? [...reg].sort((a, b) => place[a.roster_id] - place[b.roster_id]) : reg;
    $("#season-table").innerHTML = `<table><thead><tr><th></th><th>Manager</th><th>${place ? "Finish" : "Status"}</th><th class="num">Reg. seed</th><th class="num">W-L</th><th class="num">PF</th><th class="num hide-xs">PA</th></tr></thead><tbody>
      ${order.map((r, i) => `<tr><td class="rank">${i + 1}</td><td>${who(s, r.roster_id)}<div class="muted small">${esc(s.owners[r.roster_id]?.team || "")}</div></td>
        <td>${place ? finishLabel(place[r.roster_id]) : '<span class="pill live">Live</span>'}</td><td class="num">${reg.indexOf(r) + 1}</td>
        <td class="num"><b>${recordStr(r.wins, r.losses, r.ties)}</b></td><td class="num">${fmt(r.fpts)}</td><td class="num hide-xs muted">${fmt(r.fpts_against)}</td></tr>`).join("")}
      </tbody></table><p class="note">Places 1–6 come from the playoff bracket and places 7–10 from the regular season.</p>`;
  };
  $("#season-tabs").innerHTML = seasons.map((s) => `<button data-s="${s.season}">${s.season}</button>`).join("");
  document.querySelectorAll("#season-tabs button").forEach((b) => (b.onclick = () => showSeason(seasons.find((s) => s.season === b.dataset.s))));
  showSeason(seasons.find((s) => s.complete) || seasons[0]);
  $("#updated").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
});
