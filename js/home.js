/* Home page: hero stats, standings, matchups (per-matchup Upcoming / Live / Final), recent moves */
boot(async () => {
  const { league, state, teams, standings } = await loadLeague();
  const week = currentWeek(state, league), inSeason = inLeagueSeason(state, league);
  $("#week-no").textContent = week;
  const playoffTeams = league.settings.playoff_teams || 6;
  $("#playoff-pill").textContent = `Top ${playoffTeams} make playoffs`;
  /* ---- Standings ---- */
  $("#standings").innerHTML = `<table>
    <thead><tr><th></th><th>Team</th><th class="num">W-L</th><th class="num">PF</th><th class="num hide-xs">PA</th></tr></thead>
    <tbody>${standings.map((t, i) => `
      <tr class="${i === playoffTeams - 1 ? "playoff-line" : ""} ${t.isMe ? "me" : ""}">
        <td class="rank">${i + 1}</td><td>${teamChip(t, { link: true })}</td>
        <td class="num"><b>${recordStr(t.wins, t.losses, t.ties)}</b></td>
        <td class="num">${fmt(t.pf)}</td><td class="num hide-xs muted">${fmt(t.pa)}</td></tr>`).join("")}
    </tbody></table>
    <p class="note">Dashed line = playoff cut (top ${playoffTeams}). Tiebreak: points for.</p>`;

  /* ---- Matchups: per-matchup Upcoming / Live / Final from the NFL game feed ---- */
  const [players, wkRows, games, prevRows, gotw] = await Promise.all([
    loadPlayers(),
    sleeper(`/league/${LEAGUE_ID}/matchups/${week}`, { ttlMinutes: 1 }),
    inSeason ? loadNflWeek(league.season, week) : null,
    inSeason && week > 1 ? sleeper(`/league/${LEAGUE_ID}/matchups/${week - 1}`, { ttlMinutes: 5 }) : null,
    loadGotw(),
  ]);
  const curWk = inSeason ? week : 99; // out of season every listed week is final
  const games0 = pairUp(wkRows).map(([a, b]) => ({ a, b, wk: week, ...matchupStatus(a, b, week, curWk, players, games) }));
  const between = !!(inSeason && week > 1 && games0.length && games0.every((g) => g.status === "upcoming") && prevRows);
  const left = (x) => !x ? "" : x.pre + x.live === 0 ? "all done"
    : [x.pre ? `${x.pre} to play` : "", x.live ? `${x.live} live` : ""].filter(Boolean).join(" · "); // same as schLeft (schedule-data.js isn't loaded here)
  const card = (g, showPill) => {
    const row = (r, o) => {
      const t = teams.get(r.roster_id), p = r.points || 0, op = o.points || 0;
      const lead = g.status !== "upcoming" && p > op;
      const sub = g.status === "live" && g.left ? `<span class="m-left">${left(g.left[r.roster_id])}</span>` : "";
      return `<div class="mrow ${lead ? "lead" : ""}">${teamChip(t, { sub: recordStr(t.wins, t.losses, t.ties) })}<span class="mscore">${g.status === "upcoming" ? '<span class="score muted">–</span>' : `<span class="score">${fmt(p)}</span>`}${sub}</span></div>`;
    };
    const pk = g.gotw, top = pk || showPill;
    const badge = pk ? `<a class="gotw-badge" href="${gotwHref(pk)}" title="${g.status === "final" ? "Reviewed" : "Picked"} in the weekly recap">⭐ Game of the Week</a>` : "";
    return `<div class="matchup st-${g.status}${pk ? " gotw" : ""}">${top ? `<div class="m-top">${badge}${showPill ? schStatusPillMini(g.status) : ""}</div>` : ""}${row(g.a, g.b)}${row(g.b, g.a)}</div>`;
  };
  /* Tag the Game of the Week (by roster_id pair) and list it first */
  const markGotw = (list) => {
    for (const g of list) g.gotw = gotw(league.season, g.wk, g.a.roster_id, g.b.roster_id);
    return [...list.filter((g) => g.gotw), ...list.filter((g) => !g.gotw)];
  };
  const section = (title, list, wkLabel) => {
    const st = weekStatus(list.map((g) => g.status));
    const mixed = new Set(list.map((g) => g.status)).size > 1;
    return `<div class="mu-sec"><h3 class="mu-h"><span>${wkLabel}</span> ${schStatusPillMini(st)} <span class="muted small">${title}</span></h3>
      <div class="matchups">${markGotw(list).map((g) => card(g, mixed)).join("")}</div></div>`;
  };
  let html = "", anyLive = false;
  if (between) {
    const prev = pairUp(prevRows).map(([a, b]) => ({ a, b, wk: week - 1, status: "final" }));
    html = section("Last week", prev, `Week ${week - 1}`) + section("This week · no games yet", games0, `Week ${week}`);
  } else if (games0.length) {
    const st = weekStatus(games0.map((g) => g.status));
    anyLive = games0.some((g) => g.status === "live");
    html = section(st === "final" ? "All games done" : st === "upcoming" ? "No games yet" : "Scores as of page load", games0, `Week ${week}`);
  }
  $("#mu-title").textContent = between ? "Last Week & Up Next" : "This Week";
  $("#matchups").innerHTML = html ? html
    + (anyLive ? `<p class="note">Scores update as games are played (refresh to update).${games0.some((g) => g.fallback) ? " NFL game status was unavailable, so any matchup with points counts as live." : ""}</p>` : "")
    : `<p class="muted">No matchups scheduled this week.</p>`;

  /* ---- Hero stats ---- */
  const done = lastCompletedWeek(state, league);
  const hist = done ? await loadMatchups(done) : {};
  let high = null;
  for (const [w, rows] of Object.entries(hist)) for (const r of rows) if (r.matchup_id != null && (!high || r.points > high.points)) high = { ...r, week: w };
  const leader = standings[0];
  const pfLeader = [...standings].sort((a, b) => b.pf - a.pf)[0];
  const me = standings.find((t) => t.isMe);
  $("#hero").innerHTML = `
    <div class="stat"><div class="k">League leader</div><div class="v accent">${recordStr(leader.wins, leader.losses, leader.ties)}</div><div class="s">${esc(leader.teamName)} (@${esc(leader.owner)})</div></div>
    <div class="stat"><div class="k">Points-for leader</div><div class="v">${fmt(pfLeader.pf, 1)}</div><div class="s">${esc(pfLeader.teamName)}</div></div>
    <div class="stat"><div class="k">Season-high week</div><div class="v">${high ? fmt(high.points) : "–"}</div><div class="s">${high ? `${esc(teams.get(high.roster_id).teamName)} · Wk ${high.week}` : ""}</div></div>
    <div class="stat"><div class="k">Commish's squad</div><div class="v">${me ? ord(standings.indexOf(me) + 1) : "–"}</div><div class="s">${me ? `${esc(me.teamName)} (${recordStr(me.wins, me.losses, me.ties)})` : ""}</div></div>`;
  /* ---- Trade deadline countdown (Sleeper settings.trade_deadline vs the current NFL week; hidden once it passes) ---- */
  const td = league.settings.trade_deadline || 11;
  if (inSeason && week <= td) {
    const n = td - week, chip = $("#deadline-chip");
    chip.innerHTML = `<span class="dl-ico">🔒</span><span><b>${n === 0 ? "Trade deadline is this week" : `Trade deadline in ${n} week${n === 1 ? "" : "s"}`}</b> · trades lock after Week ${td}</span>`;
    chip.href = `schedule.html?season=${league.season}&week=${td}`;
    chip.hidden = false;
  }
  /* ---- Playoffs countdown (settings.playoff_week_start vs the shared current week; stays after the deadline chip goes) ---- */
  const pws = league.settings.playoff_week_start || 15;
  if (inSeason && week <= pws + 2) {
    const n = pws - week, chip = $("#playoff-chip");
    const round = ["Round 1", "Semifinals", "Championship"][week - pws];
    chip.innerHTML = `<span class="dl-ico">🏆</span><span>${n > 0 ? `<b>Playoffs in ${n} week${n === 1 ? "" : "s"}</b> · start Week ${pws}`
      : n === 0 ? `<b>Playoffs start this week</b> · Week ${pws} · Round 1` : `<b>Playoffs: Week ${week}</b> · ${round}`}</span>`;
    chip.href = `schedule.html?season=${league.season}&week=${Math.max(week, pws)}`;
    chip.hidden = false;
  }
  $("#home-sub").textContent = `${league.season} season · ${league.total_rosters} teams · trade deadline Week ${league.settings.trade_deadline} · playoffs start Week ${league.settings.playoff_week_start}`;

  /* ---- Recent moves: the last 14 days (the current Sleeper week and the two before cover it) ---- */
  const DAYS = 14, since = Date.now() - DAYS * 864e5, ts = (t) => t.status_updated || t.created;
  const txWeeks = [week, week - 1, week - 2].filter((w) => w >= 1);
  const allTx = (await Promise.all(txWeeks.map((w) => sleeper(`/league/${LEAGUE_ID}/transactions/${w}`, { ttlMinutes: 2 }).catch(() => [])))).flat();
  const txs = allTx.filter((t) => t.status === "complete" && ts(t) >= since).sort((a, b) => ts(b) - ts(a)).slice(0, 25);
  /* Waiver claim counts: distinct teams that claimed the same player in the same waiver run
     (same week + same processing time; Sleeper's feed includes the failed claims), winner included */
  const claimsFor = (w) => {
    const pid = Object.keys(w.adds || {})[0];
    const rivals = allTx.filter((t) => t.type === "waiver" && t.leg === w.leg && t.adds && pid in t.adds && Math.abs(ts(t) - ts(w)) < 5 * 60e3);
    return [...new Set(rivals.map((t) => t.roster_ids[0]))];
  };
  const pl = (id) => { const p = players[id]; return p ? `${esc(p.n)} <span class="muted small">${slotPos(p)}${p.t ? " · " + p.t : ""}</span>` : `Player #${esc(id)}`; };
  const name = (rid) => esc(teams.get(rid)?.teamName || "Roster " + rid);
  const when = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  $("#transactions").innerHTML = txs.length ? txs.map((t) => {
    let body;
    if (t.type === "trade") {
      body = t.roster_ids.map((rid) => {
        const gets = Object.entries(t.adds || {}).filter(([, r]) => r === rid).map(([p]) => pl(p));
        const picks = (t.draft_picks || []).filter((d) => d.owner_id === rid).map((d) => `${d.season} Rd ${d.round} pick (${name(d.roster_id)})`);
        return `<div><b>${name(rid)}</b> gets: ${[...gets, ...picks].join(", ") || "nothing"}</div>`;
      }).join("");
    } else {
      const rid = t.roster_ids[0];
      const adds = Object.keys(t.adds || {}).map((p) => `<span class="add">+</span> ${pl(p)}`);
      const drops = Object.keys(t.drops || {}).map((p) => `<span class="drop">−</span> ${pl(p)}`);
      body = `<b>${name(rid)}</b> &nbsp;${[...adds, ...drops].join(" &nbsp; ")}`;
      if (t.type === "waiver") {
        const who = claimsFor(t);
        if (who.length > 1) body += `<div class="tx-claims"><span class="claims">${who.length} claims</span> <span class="muted small">Also claimed by ${who.filter((r) => r !== rid).map(name).join(", ")}</span></div>`;
      }
    }
    return `<div class="tx"><span class="tx-type ${t.type}">${t.type.replace("_", " ")}</span><div style="flex:1;min-width:0">${body}</div><span class="muted small">${when(ts(t))}</span></div>`;
  }).join("") : `<p class="muted">No moves in the last 14 days. Quiet in the patch.</p>`;
  $("#updated").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
});
