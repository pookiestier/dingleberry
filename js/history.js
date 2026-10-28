/* History & Record Book. Data loading, records and brackets live in js/league-history.js (shared with Team Info). */
boot(async () => {
  const ctx = await loadLeagueHistory();
  const { league, teams, seasons } = ctx;
  const W = (s, rid) => who(ctx, s, rid);

  /* ---- Trophy case ---- */
  $("#trophies").innerHTML = seasons.map((s) => {
    const reg = regRank(s), mostPf = [...s.rosters].sort((a, b) => b.fpts - a.fpts)[0];
    if (!s.complete) {
      const lead = reg[0];
      return `<div class="card season-card"><div class="year">${s.season}</div><span class="pill live">In progress</span>
        <div class="champ">Champion: TBD</div>
        <dl><dt>Current leader</dt><dd>${W(s, lead.roster_id)} (${recordStr(lead.wins, lead.losses, lead.ties)})</dd>
        <dt>PF leader</dt><dd>${W(s, mostPf.roster_id)} (${fmt(mostPf.fpts)})</dd>
        <dt>Playoffs</dt><dd>Week ${s.playoff_week_start}</dd></dl></div>`;
    }
    const final = s.winners_bracket.find((m) => m.p === 1), third = s.winners_bracket.find((m) => m.p === 3);
    return `<div class="card season-card"><span class="trophy">🏆</span><div class="year">${s.season}</div>
      <div class="champ">${W(s, final.w)}</div><div class="muted small">${esc(s.owners[final.w]?.team || "")}</div>
      <dl><dt><span class="medal s">2</span> Runner-up</dt><dd>${W(s, final.l)}</dd>
      <dt><span class="medal b">3</span> Third</dt><dd>${third ? W(s, third.w) : "–"}</dd>
      <dt>Reg. season champ</dt><dd>${W(s, reg[0].roster_id)} (${recordStr(reg[0].wins, reg[0].losses, reg[0].ties)})</dd>
      <dt>Most points for</dt><dd>${W(s, mostPf.roster_id)} (${fmt(mostPf.fpts)})</dd></dl></div>`;
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
      return `<tr class="${t.isMe ? "me" : ""}"><td>${teamChip(t, { link: true, sub: "@" + esc(t.owner) + (prior.length ? ` · was ${prior.map(esc).join(", ")}` : "") })}</td>
      <td class="num"><b>${f.w}-${f.l}-${f.t}</b></td><td class="num">${pct((f.w + f.t / 2) / (f.w + f.l + f.t))}</td>
      <td class="num hide-xs muted">${fmt(f.pf, 0)}</td><td class="num">${f.titles ? "🏆".repeat(f.titles) : ""}</td></tr>`;
    }).join("")}</tbody></table>
    <p class="note">${seasons.length} seasons (${seasons.filter((s) => s.complete).length} complete + ${league.season} so far). Regular season only. Click a team for its full history.</p>`;

  /* ---- Playoff résumés (championship bracket only; 3rd/5th place games excluded) ---- */
  const po = {};
  for (const s of seasons.filter((x) => x.complete)) {
    const inBracket = new Set();
    for (const m of s.winners_bracket) {
      [m.t1, m.t2].forEach((x) => typeof x === "number" && inBracket.add(x));
      if (m.p != null && m.p !== 1) continue;
      const Wn = (po[m.w] ||= { rid: m.w, app: 0, w: 0, l: 0, ca: 0, c: 0 }), L = (po[m.l] ||= { rid: m.l, app: 0, w: 0, l: 0, ca: 0, c: 0 });
      Wn.w++; L.l++;
      if (m.p === 1) { Wn.ca++; L.ca++; Wn.c++; }
    }
    for (const rid of inBracket) (po[rid] ||= { rid, app: 0, w: 0, l: 0, ca: 0, c: 0 }).app++;
  }
  const poList = Object.values(po).sort((a, b) => b.c - a.c || b.ca - a.ca || b.w - a.w || a.l - b.l || b.app - a.app);
  $("#playoffs").innerHTML = `<table><thead><tr><th>Franchise</th><th class="num">Apps</th><th class="num">W-L</th><th class="num">Finals</th><th class="num">Titles</th></tr></thead><tbody>
    ${poList.map((p) => { const t = teams.get(p.rid); return `<tr class="${t.isMe ? "me" : ""}"><td>${teamChip(t, { link: true })}</td><td class="num">${p.app}</td><td class="num"><b>${p.w}-${p.l}</b></td><td class="num">${p.ca}</td><td class="num">${p.c ? "🏆".repeat(p.c) : "–"}</td></tr>`; }).join("")}
    </tbody></table><p class="note">Sorted by championships, then finals appearances, wins, losses, and appearances (same order as the charter). Results are credited to the franchise (roster slot).</p>`;

  /* ---- Playoff brackets ---- */
  const bracketSeasons = seasons.filter((s) => s.complete && s.winners_bracket?.length);
  // The current season joins the picker once Sleeper has generated its bracket
  try {
    const live = seasons.find((s) => !s.complete);
    const [wb, lb] = await Promise.all([sleeper(`/league/${LEAGUE_ID}/winners_bracket`, { ttlMinutes: 10 }), sleeper(`/league/${LEAGUE_ID}/losers_bracket`, { ttlMinutes: 10 })]);
    if (live && Array.isArray(wb) && wb.length) { live.winners_bracket = wb; live.losers_bracket = lb || []; bracketSeasons.unshift(live); }
  } catch (e) { /* no live bracket yet */ }
  // Default to the most recent completed season (a live bracket is only a projection until Week 15)
  let bkSeason = bracketSeasons.find((s) => s.complete) || bracketSeasons[0], bkKind = "winners";
  const projected = (s) => !s.complete && (ctx.done || 0) < s.playoff_week_start;
  const drawBracket = () => {
    $("#bracket").innerHTML = (projected(bkSeason) ? `<p class="bk-proj"><span class="pill live">Projected</span> Sleeper's ${bkSeason.season} bracket if the season ended today (through Week ${ctx.done}). It will fill in as the playoffs are played.</p>` : "") + renderBracket(ctx, bkSeason, bkKind);
    document.querySelectorAll("#bracket-kind button").forEach((b) => b.classList.toggle("active", b.dataset.k === bkKind));
    $("#bracket-note").innerHTML = bkKind === "winners"
      ? `Top ${bkSeason.playoff_teams || 6} make it; seeds 1–2 get a first-round bye. Seeds follow the final regular-season standings (win %, then points for). Scores are the real matchup totals from Sleeper.`
      : `Sleeper runs the bottom four as a toilet bowl: the <b>loser</b> of each game moves on, and whoever loses the final is the last team standing. Round 1 winners play for 7th. Final standings on this site still rank places 7–10 by regular-season record.`;
  };
  $("#bracket-season").innerHTML = bracketSeasons.map((s) => `<option value="${s.season}">${s.season}${s.complete ? "" : projected(s) ? " (projected)" : " (live)"}</option>`).join("");
  $("#bracket-season").value = bkSeason.season;
  $("#bracket-season").onchange = (e) => { bkSeason = bracketSeasons.find((s) => s.season === e.target.value); drawBracket(); };
  document.querySelectorAll("#bracket-kind button").forEach((b) => (b.onclick = () => { bkKind = b.dataset.k; drawBracket(); }));
  drawBracket();

  /* ---- Record book (one panel) ---- */
  renderRecordBook($("#records"), recordCategories(ctx), recordNote(ctx));

  /* ---- Final standings by season (tabs) ---- */
  const showSeason = (s) => {
    document.querySelectorAll("#season-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.s === s.season));
    const place = s.complete ? placements(s) : null;
    const reg = regRank(s);
    const order = place ? [...reg].sort((a, b) => place[a.roster_id] - place[b.roster_id]) : reg;
    $("#season-table").innerHTML = `<table><thead><tr><th></th><th>Manager</th><th>${place ? "Finish" : "Status"}</th><th class="num" title="Regular-season seed">Seed</th><th class="num">W-L</th><th class="num">PF</th><th class="num hide-xs">PA</th></tr></thead><tbody>
      ${order.map((r, i) => `<tr><td class="rank">${i + 1}</td><td>${W(s, r.roster_id)}<div class="muted small">${esc(s.owners[r.roster_id]?.team || "")}</div></td>
        <td>${place ? finishLabel(place[r.roster_id]) : '<span class="pill live">Live</span>'}</td><td class="num">${reg.indexOf(r) + 1}</td>
        <td class="num"><b>${recordStr(r.wins, r.losses, r.ties)}</b></td><td class="num">${fmt(r.fpts)}</td><td class="num hide-xs muted">${fmt(r.fpts_against)}</td></tr>`).join("")}
      </tbody></table><p class="note">Places 1–6 come from the playoff bracket and places 7–10 from the regular season.</p>`;
  };
  $("#season-tabs").innerHTML = seasons.map((s) => `<button data-s="${s.season}">${s.season}</button>`).join("");
  document.querySelectorAll("#season-tabs button").forEach((b) => (b.onclick = () => showSeason(seasons.find((s) => s.season === b.dataset.s))));
  showSeason(seasons.find((s) => s.complete) || seasons[0]);
  $("#updated").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
});
