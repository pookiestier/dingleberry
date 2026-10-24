/* Rookie Draft & Dynasty page
   - Pick ownership = every team's default picks, then Sleeper's traded_picks applied on top
   - Projected order follows charter §1.3 using current standings
   - Dynasty values from FantasyCalc's free public API (10-team, 1QB, full PPR dynasty).
     FantasyCalc only values QB/RB/WR/TE and picks, so K and IDP players count as 0. */
const FC_URL = "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&numTeams=10&ppr=1";
const RD = ["1st", "2nd", "3rd", "4th"];

boot(async () => {
  const [{ league, teams, standings }, traded, drafts, players] = await Promise.all([
    loadLeague(),
    sleeper(`/league/${LEAGUE_ID}/traded_picks`),
    sleeper(`/league/${LEAGUE_ID}/drafts`),
    loadPlayers(),
  ]);
  const rounds = league.settings.draft_rounds || 4;
  const base = +league.season + (league.status === "pre_draft" ? 0 : 1);
  const tradedSeasons = traded.map((t) => +t.season);
  const lastSeason = Math.max(base + 1, ...tradedSeasons);
  const seasons = []; for (let y = base; y <= lastSeason; y++) seasons.push(String(y));

  /* ---- Who owns each pick: owner[season][round][originalRosterId] = current roster id ---- */
  const owner = {};
  for (const s of seasons) { owner[s] = {}; for (let r = 1; r <= rounds; r++) { owner[s][r] = {}; for (const id of teams.keys()) owner[s][r][id] = id; } }
  for (const t of traded) if (owner[t.season]?.[t.round]) owner[t.season][t.round][t.roster_id] = t.owner_id;
  const short = (rid) => esc(teams.get(rid)?.owner || rid);

  /* ---- Projected next draft order (charter §1.3) ---- */
  const seeds = standings.map((t) => t.rosterId);          // index 0 = 1 seed
  const order = [...seeds.slice(6).reverse(), ...seeds.slice(0, 6).reverse()]; // picks 1..10
  const s0 = seasons[0];
  $("#draft-order").innerHTML = `<table><thead><tr><th>Pick</th><th>Slot (original team)</th><th>Rd 1 owner</th><th class="num hide-xs">Rd 2 owner</th></tr></thead><tbody>
    ${order.map((rid, i) => {
      const t = teams.get(rid), o1 = owner[s0][1][rid], o2 = owner[s0][2][rid];
      return `<tr class="${i === 3 ? "playoff-line" : ""}"><td class="rank">1.${String(i + 1).padStart(2, "0")}</td>
        <td>${teamChip(t, { sub: `${ord(seeds.indexOf(rid) + 1)} seed · ${recordStr(t.wins, t.losses, t.ties)}` })}</td>
        <td>${o1 !== rid ? `<b class="add">${short(o1)}</b> <span class="muted small">via trade</span>` : `<span class="muted">own</span>`}</td>
        <td class="num hide-xs">${o2 !== rid ? `<b class="add">${short(o2)}</b>` : `<span class="muted">own</span>`}</td></tr>`;
    }).join("")}</tbody></table>`;

  /* ---- Pick ownership grid ---- */
  const holdings = (rid, s) => {
    const chips = [];
    for (let r = 1; r <= rounds; r++) for (const [orig, cur] of Object.entries(owner[s][r]))
      if (cur === rid) chips.push(`<span class="pick-chip r${r} ${+orig !== rid ? "acq" : ""}">R${r}${+orig !== rid ? ` (${short(+orig)})` : ""}</span>`);
    return chips.join("") || `<span class="muted small">none</span>`;
  };
  $("#picks").innerHTML = `<table class="picks-table"><thead><tr><th>Team</th>${seasons.map((s) => `<th>${s} picks</th><th class="num">#</th>`).join("")}</tr></thead><tbody>
    ${standings.map((t) => `<tr class="${t.isMe ? "me" : ""}"><td>${teamChip(t)}</td>${seasons.map((s) => {
      const n = Object.values(owner[s]).reduce((a, r) => a + Object.values(r).filter((x) => x === t.rosterId).length, 0);
      return `<td class="holds" data-label="${s} · ${n} pick${n === 1 ? "" : "s"}" style="white-space:normal">${holdings(t.rosterId, s)}</td><td class="num cnt"><b>${n}</b></td>`;
    }).join("")}</tr>`).join("")}</tbody></table>`;

  /* ---- Dynasty values (FantasyCalc) ---- */
  try {
    const fc = await getJSON(FC_URL, { ttlMinutes: 60 });
    const bySleeper = {}, pickVal = {};
    for (const v of fc) {
      if (v.player.position === "PICK") {
        const m = v.player.name.match(/^(\d{4}) (\d)(?:st|nd|rd|th)$/); // generic "2027 1st" (not Early/Mid/Late)
        if (m) pickVal[`${m[1]}-${m[2]}`] = v.value;
      } else if (v.player.sleeperId) bySleeper[v.player.sleeperId] = { value: v.value, name: v.player.name };
    }
    const rows = standings.map((t) => {
      const vals = t.players.map((id) => ({ id, v: bySleeper[id]?.value || 0 })).sort((a, b) => b.v - a.v);
      const playerTotal = vals.reduce((a, x) => a + x.v, 0);
      let pickTotal = 0;
      for (const s of seasons) for (let r = 1; r <= rounds; r++) for (const cur of Object.values(owner[s][r])) if (cur === t.rosterId) pickTotal += pickVal[`${s}-${r}`] || 0;
      return { t, playerTotal, pickTotal, total: playerTotal + pickTotal, top: vals[0] };
    }).sort((a, b) => b.total - a.total);
    const max = rows[0].total;
    $("#values").innerHTML = `<table><thead><tr><th></th><th>Team</th><th class="num">Players</th><th class="num hide-xs">Picks</th><th class="num">Total</th></tr></thead><tbody>
      ${rows.map((x, i) => `<tr class="${x.t.isMe ? "me" : ""}"><td class="rank">${i + 1}</td>
        <td>${teamChip(x.t, { sub: x.top && x.top.v ? `Top asset: ${esc(players[x.top.id]?.n || bySleeper[x.top.id].name)}` : "" })}
          <div class="bar" style="margin-top:6px"><i style="width:${(x.total / max) * 100}%"></i></div></td>
        <td class="num">${fmt(x.playerTotal, 0)}</td><td class="num hide-xs muted">${fmt(x.pickTotal, 0)}</td><td class="num"><b>${fmt(x.total, 0)}</b></td></tr>`).join("")}
      </tbody></table>`;
    $("#values-note").innerHTML = `Values from <a href="https://fantasycalc.com" target="_blank" rel="noopener">FantasyCalc</a> (dynasty, 10 teams, 1 QB, PPR), fetched live. They cover offensive players (QB/RB/WR/TE) and picks only, so kickers and IDP count as 0. Picks for ${seasons.join(" & ")} use FantasyCalc's generic round values. These are market values for trade talk, not gospel.`;
  } catch (e) {
    $("#values").innerHTML = `<p class="muted">Dynasty values are coming soon (couldn't reach FantasyCalc: ${esc(e.message)}).</p>`;
  }

  /* ---- Past rookie drafts in this league ---- */
  const done = drafts.filter((d) => d.status === "complete");
  const boards = await Promise.all(done.map((d) => sleeper(`/draft/${d.draft_id}/picks`, { ttlMinutes: 60 })));
  $("#drafts").innerHTML = done.map((d, i) => {
    const picks = boards[i];
    const byRound = {}; for (const p of picks) (byRound[p.round] ||= []).push(p);
    return `<h3 style="margin:0 0 10px">${d.season} Rookie Draft <span class="pill">${picks.length} picks · ${d.settings.rounds} rounds</span></h3>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(250px,1fr))">${Object.entries(byRound).map(([r, ps]) => `<div>
        <div class="pos-label">Round ${r}</div>${ps.map((p) => {
          const pos = p.metadata.position;
          return `<div class="player"><span class="muted small" style="width:34px">${r}.${String(p.draft_slot).padStart(2, "0")}</span><span class="pos ${slotPos({ p: pos })}">${esc(pos)}</span>
          <span class="pname">${esc(p.metadata.first_name + " " + p.metadata.last_name)}</span><span class="team-abbr">${short(p.roster_id)}</span></div>`;
        }).join("")}</div>`).join("")}</div>`;
  }).join("") || `<p class="muted">No completed drafts in this league yet.</p>`;
  $("#updated").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
});
