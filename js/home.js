/* Home page: hero stats, live standings, this week's matchups, recent transactions */
boot(async () => {
  const { league, state, teams, standings } = await loadLeague();
  const week = state.season === league.season ? state.display_week || state.week : 1;
  $("#week-no").textContent = week;
  const playoffTeams = league.settings.playoff_teams || 6;

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

  /* ---- This week's matchups (and season-high score for the hero) ---- */
  const [players, wkRows] = await Promise.all([loadPlayers(), sleeper(`/league/${LEAGUE_ID}/matchups/${week}`, { ttlMinutes: 1 })]);
  const pairs = pairUp(wkRows);
  // Each matchup is a two-row card: team + score per row, leader highlighted
  $("#matchups").innerHTML = pairs.length ? pairs.map(([a, b]) => {
    const row = (r, other) => {
      const t = teams.get(r.roster_id), p = r.points || 0, lead = p > (other.points || 0);
      return `<div class="mrow ${lead ? "lead" : ""}">${teamChip(t, { sub: recordStr(t.wins, t.losses, t.ties) })}<span class="score">${fmt(p)}</span></div>`;
    };
    return `<div class="matchup">${row(a, b)}${row(b, a)}</div>`;
  }).join("") + `<p class="note">Scores update as games are played (refresh to update).</p>` : `<p class="muted">No matchups scheduled this week.</p>`;

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
  $("#home-sub").textContent = `${league.season} season · ${league.total_rosters} teams · trade deadline Week ${league.settings.trade_deadline} · playoffs start Week ${league.settings.playoff_week_start}`;

  /* ---- Recent transactions (this week + last week) ---- */
  const txWeeks = [week, week - 1].filter((w) => w >= 1);
  const txs = (await Promise.all(txWeeks.map((w) => sleeper(`/league/${LEAGUE_ID}/transactions/${w}`, { ttlMinutes: 2 })))).flat()
    .filter((t) => t.status === "complete")
    .sort((a, b) => b.created - a.created).slice(0, 14);
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
    }
    return `<div class="tx"><span class="tx-type ${t.type}">${t.type.replace("_", " ")}</span><div style="flex:1;min-width:0">${body}</div><span class="muted small">${when(t.created)}</span></div>`;
  }).join("") : `<p class="muted">No moves in the last two weeks. Quiet in the patch.</p>`;
  $("#updated").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
});
