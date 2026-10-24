/* Team Info: one franchise (Sleeper roster slot), chosen from the dropdown. Shows its header and
   all-time summary, current roster, schedule (any season, playoff and toilet-bowl games labeled),
   season-by-season results, record book and head-to-head.
   A franchise keeps its roster_id when it changes hands, so a former manager's seasons count here,
   shown under the name that manager used that season ("now @x" marks the hand-off). */
const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DL", "LB", "DB"];

boot(async () => {
  const [ctx, sched, players] = await Promise.all([loadLeagueHistory(), loadSchedules(), loadPlayers()]);
  const { teams, seasons, scores } = ctx;
  const list = [...teams.values()].sort((a, b) => a.teamName.localeCompare(b.teamName, undefined, { sensitivity: "base" }));
  const sel = $("#team-pick");
  sel.innerHTML = list.map((t) => `<option value="${t.rosterId}">${esc(t.teamName)} · @${esc(t.owner)}</option>`).join("");
  const fromUrl = () => { const q = +new URLSearchParams(location.search).get("team"); return teams.has(q) ? q : (list.find((t) => t.isMe) || list[0]).rosterId; };
  const seasonFromUrl = () => { const q = new URLSearchParams(location.search).get("season"); return sched.seasons.some((x) => x.season === q) ? q : sched.seasons[0].season; };
  let rid = fromUrl(), schedSeason = seasonFromUrl();
  const sync = () => history.replaceState(null, "", `?team=${rid}${schedSeason !== sched.seasons[0].season ? `&season=${schedSeason}` : ""}`);
  sel.onchange = () => { rid = +sel.value; history.pushState(null, "", `?team=${rid}${schedSeason !== sched.seasons[0].season ? `&season=${schedSeason}` : ""}`); render(); };
  window.onpopstate = () => { rid = fromUrl(); schedSeason = seasonFromUrl(); render(); };
  const sp = $("#sched-season");
  sp.innerHTML = sched.seasons.map((x) => `<option value="${x.season}">${x.season}${x.complete ? "" : " (current)"}</option>`).join("");
  sp.onchange = () => { schedSeason = sp.value; sync(); renderSchedule(); };
  render();

  /* ---- Roster (current season, from the Sleeper rosters endpoint) ---- */
  function renderRoster(t) {
    const playerRow = (id) => {
      const p = players[id];
      const pos = slotPos(p);
      const starter = t.starters.includes(id);
      const inj = p && p.inj ? ` <span class="inj">${esc(p.inj.slice(0, 3).toUpperCase())}</span>` : "";
      return `<div class="player ${starter ? "starter" : ""}"><span class="pos ${pos}">${pos}</span>
        <span class="pname">${p ? esc(p.n) : "Player #" + esc(id)}${starter ? ' <span class="star">★</span>' : ""}${inj}</span>
        <span class="team-abbr">${p && p.t ? p.t : "FA"}${p && p.a ? " · " + p.a : ""}</span></div>`;
    };
    const special = new Set([...t.taxi, ...t.reserve]);
    const active = t.players.filter((id) => !special.has(id));
    const group = (label, ids) => ids.length ? `<div class="pos-group"><div class="pos-label">${label} · ${ids.length}</div>${ids.map(playerRow).join("")}</div>` : "";
    const groups = POS_ORDER.map((pos) => group(pos, active.filter((id) => slotPos(players[id]) === pos).sort((a, b) => t.starters.includes(b) - t.starters.includes(a)))).join("");
    const place = ctx.standings.findIndex((x) => x.rosterId === t.rosterId) + 1;
    $("#ti-roster").innerHTML = `<div class="ti-box-head"><h2>🏈 Roster <span class="pill">${t.players.length} players</span></h2>
        <span class="muted small">${ctx.league.season}: ${recordStr(t.wins, t.losses, t.ties)} · ${ord(place)} · ${fmt(t.pf, 1)} PF</span></div>
      <p class="muted small ti-legend"><span class="star">★</span> = in this week's starting lineup</p>
      <div class="roster-card ti-roster">${groups}${group("Taxi squad", t.taxi)}${group("Injured reserve", t.reserve)}</div>`;
  }

  /* ---- Schedule for the selected season ---- */
  function renderSchedule() {
    sp.value = schedSeason;
    const S = sched.seasons.find((x) => x.season === schedSeason);
    const rowsOut = [];
    let w = 0, l = 0, tie = 0, left = 0;
    for (const wk of S.weeks) {
      const g = wk.games.find((x) => x.a === rid || x.b === rid);
      if (!g) {
        if (wk.byes.includes(rid)) rowsOut.push(`<tr class="sched-po"><td class="num">${wk.wk}</td><td colspan="3"><span class="sched-tag po">Playoffs</span> <b>Bye</b> <span class="muted small">· top-2 seed skips round 1</span></td></tr>`);
        else if (wk.tbd && wk.round === 1) rowsOut.push(`<tr class="sched-po"><td class="num">${wk.wk}–${wk.wk + 2}</td><td colspan="3" class="muted small"><span class="sched-tag po">Playoffs</span> Weeks ${wk.wk}–${wk.wk + 2}: top 6 make the playoffs, bottom 4 play the Toilet Bowl. Matchups are set after Week ${S.W - 1}.</td></tr>`);
        continue;
      }
      const me = g.a === rid, o = me ? g.b : g.a, mp = me ? g.ap : g.bp, op = me ? g.bp : g.ap;
      const res = g.status !== "final" ? "" : g.tie ? "T" : g.winner === rid ? "W" : "L";
      if (!g.label) { if (res === "W") w++; else if (res === "L") l++; else if (res === "T") tie++; else left++; }
      let tag = g.label ? `<span class="sched-tag ${g.kind === "tb" ? "tb" : "po"}">${esc(g.label)}</span>` : "";
      for (const x of wk.special || []) if (x.type !== "rivalry") tag += `<span class="sp-tag ${x.type}">${SCH_SPECIAL_ICON[x.type]} ${x.tag}</span>`;
      if (g.rivalry) tag += `<span class="sp-tag rivalry">⚔️ Rivalry Week</span>`;
      const extra = g.rivalry ? `<div class="sched-rival">⚔️ <b>${esc(g.rivalry.name)}</b> · <span class="muted">${schSeries(me ? g.rivalry.rec : { ...g.rivalry.rec, aw: g.rivalry.rec.bw, bw: g.rivalry.rec.aw }, schName(S, rid), schName(S, o))}</span></div>`
        : g.rematchOf ? `<div class="sched-rival muted small">Rematch of ${+S.season - 1} Wk ${g.rematchOf.wk}${g.rematchOf.label ? ` (${esc(g.rematchOf.label)})` : ""}: ${fmt(g.rematchOf.a === rid ? g.rematchOf.ap : g.rematchOf.bp)}–${fmt(g.rematchOf.a === rid ? g.rematchOf.bp : g.rematchOf.ap)} ${g.rematchOf.tie ? "T" : g.rematchOf.winner === rid ? "W" : "L"}</div>` : "";
      const spCls = [...(wk.special || []).filter((x) => x.type !== "rivalry").map((x) => `sp-${x.type}`), g.rivalry ? "sp-rivalry" : ""].join(" ");
      const score = g.status === "upcoming" ? '<span class="muted small">Upcoming</span>'
        : `<span class="${res === "W" ? "" : "muted"}"><b>${fmt(mp)}</b></span><span class="muted">–${fmt(op)}</span>${g.status === "live" ? ' <span class="pill live">Live</span>' : ""}`;
      rowsOut.push(`<tr class="${g.label ? (g.kind === "tb" ? "sched-tb" : "sched-po") : ""} ${spCls}"><td class="num">${g.wk}</td>
        <td>${tag ? `<div class="sched-tags">${tag}</div>` : ""}<div class="sched-opp"><img class="avatar" src="${avatarUrl(S.owners[o]?.avatar)}" alt="" loading="lazy"><div class="team-names">
          <span class="team-name"><span class="muted small">vs</span> <a class="tlink" href="${schTeamHref(o)}">${esc(schName(S, o))}</a></span><span class="owner">@${esc(S.owners[o]?.name || "?")}</span>${extra}</div></div></td>
        <td class="num sched-score">${score}</td>
        <td class="num">${res ? `<span class="res ${res}">${res}</span>` : ""}</td></tr>`);
    }
    const asName = schName(S, rid);
    $("#ti-schedule-body").innerHTML = `<div class="muted small ti-sched-sum">${esc(asName)} · @${esc(S.owners[rid]?.name || "?")} · regular season ${recordStr(w, l, tie)}${left ? ` · ${left} to play` : ""}</div>
      <div class="table-wrap"><table class="sched-table"><thead><tr><th class="num">Wk</th><th>Opponent</th><th class="num">Score</th><th class="num"></th></tr></thead>
      <tbody>${rowsOut.join("")}</tbody></table></div>
      <p class="note">${S.complete ? "Playoff and Toilet Bowl games come from that season's Sleeper brackets. In the Toilet Bowl the loser advances; W/L here is the real scoreboard result." : `Live from Sleeper. Week ${S.liveWeek} is in progress; later weeks are unplayed.`} The franchise is followed by its Sleeper roster slot, so seasons under a former manager show that manager's team. 🔒 Trades lock after Week ${S.tradeDeadline}.${S.rematch ? ` 🔁 Week 1 replays each team's final ${+S.season - 1} game.` : ""} ⚔️ Rivalry head-to-head counts every game between the two franchises, including playoff, placement and Toilet Bowl games.</p>`;
  }

  function render() {
    sel.value = rid;
    const t = teams.get(rid);
    document.title = `${t.teamName} · Team Info · Dingleberry League`;
    renderRoster(t);
    renderSchedule();
    const complete = seasons.filter((s) => s.complete);

    /* ---- Per-season facts ---- */
    const rows = seasons.map((s) => {
      const r = s.rosters.find((x) => x.roster_id === rid);
      const seed = seedMap(s)[rid];
      const place = s.complete ? placements(s)[rid] : null;
      const wb = (s.winners_bracket || []).filter((m) => m.t1 === rid || m.t2 === rid).sort((a, b) => a.r - b.r);
      const inPO = s.complete && wb.length > 0;
      const path = [];
      if (inPO && seed <= 2) path.push("bye");
      for (const m of wb) {
        const o = m.t1 === rid ? m.t2 : m.t1, won = m.w === rid;
        const tag = m.p === 1 ? " in the final" : m.p === 3 ? " for 3rd" : m.p === 5 ? " for 5th" : "";
        path.push(`${won ? "beat" : "lost to"} ${esc(seasonTeam(s, o))}${tag}`);
      }
      const poGames = wb.filter((m) => m.p == null || m.p === 1);
      return { s, r, seed, place, inPO, path, poW: poGames.filter((m) => m.w === rid).length, poL: poGames.filter((m) => m.l === rid).length };
    });
    const done = rows.filter((x) => x.s.complete);
    const tot = rows.reduce((a, x) => ({ w: a.w + x.r.wins, l: a.l + x.r.losses, t: a.t + x.r.ties, pf: a.pf + x.r.fpts, pa: a.pa + x.r.fpts_against }), { w: 0, l: 0, t: 0, pf: 0, pa: 0 });
    const gp = tot.w + tot.l + tot.t;
    const apps = done.filter((x) => x.inPO).length;
    const poW = done.reduce((a, x) => a + x.poW, 0), poL = done.reduce((a, x) => a + x.poL, 0);
    const titles = done.filter((x) => x.place === 1), runners = done.filter((x) => x.place === 2);
    const best = done.length ? Math.min(...done.map((x) => x.place)) : null;

    /* Manager lineage, oldest first: "selahhelah 2022–2023 → Piorkowski11 2024–now" */
    const lineage = [];
    for (const x of [...rows].reverse()) {
      const n = x.s.owners[rid]?.name, last = lineage[lineage.length - 1];
      if (last && last.name === n) last.to = x.s; else lineage.push({ name: n, from: x.s, to: x.s });
    }
    const span = (l) => !l.to.complete ? `${l.from.season}–now` : l.from === l.to ? l.from.season : `${l.from.season}–${l.to.season}`;

    $("#th-header").innerHTML = `<div class="th-header">
      <img class="avatar xl" src="${avatarUrl(t.avatar)}" alt="">
      <div class="th-title"><h2>${esc(t.teamName)}</h2>
        <div class="th-meta">@${esc(t.owner)} · Franchise slot #${rid} · ${rows.length} seasons</div>
        <div class="th-meta" style="margin-top:4px">${lineage.length > 1 ? `Managers: ${lineage.map((l) => `<b>${esc(l.name)}</b> ${span(l)}`).join(" → ")}` : `Managed by <b>${esc(t.owner)}</b> since ${lineage[0].from.season}`}</div></div>
      <div class="th-banners">${titles.map((x) => `<span class="th-banner">🏆 ${x.s.season}</span>`).join("")}${runners.map((x) => `<span class="th-banner" style="color:var(--silver)">🥈 ${x.s.season}</span>`).join("")}</div>
    </div>`;

    $("#th-hero").innerHTML = `
      <div class="stat"><div class="k">All-time record</div><div class="v accent">${tot.w}-${tot.l}${tot.t ? "-" + tot.t : ""}</div><div class="s">${pct((tot.w + tot.t / 2) / Math.max(1, gp))} · ${rows.length} seasons</div></div>
      <div class="stat"><div class="k">Points for / against</div><div class="v">${fmt(tot.pf, 0)}</div><div class="s">PA ${fmt(tot.pa, 0)} · ${fmt(tot.pf / Math.max(1, gp), 1)}/gm</div></div>
      <div class="stat"><div class="k">Playoffs</div><div class="v">${apps} of ${complete.length}</div><div class="s">Playoff record ${poW}-${poL}</div></div>
      <div class="stat"><div class="k">Championships</div><div class="v">${titles.length ? "🏆".repeat(titles.length) : "0"}</div><div class="s">${runners.length ? `${runners.length}× runner-up` : `Best finish ${best ? ord(best) : "–"}`}</div></div>`;

    /* ---- Season by season ---- */
    $("#th-seasons").innerHTML = `<table><thead><tr><th>Season</th><th>Team that year</th><th class="num">W-L</th><th class="num hide-xs">PF</th><th class="num hide-xs">PA</th><th class="num hide-xs">Seed</th><th>Finish</th></tr></thead><tbody>
      ${rows.map((x) => `<tr class="${x.place === 1 ? "th-champ" : ""}"><td><b>${x.s.season}${star(x.s)}</b></td>
        <td><b>${esc(seasonTeam(x.s, rid))}</b><div class="muted small">${who(ctx, x.s, rid, { link: false })}</div><div class="muted small show-xs">${fmt(x.r.fpts)} PF · ${ord(x.seed)} seed</div></td>
        <td class="num"><b>${recordStr(x.r.wins, x.r.losses, x.r.ties)}</b></td><td class="num hide-xs">${fmt(x.r.fpts)}</td><td class="num hide-xs muted">${fmt(x.r.fpts_against)}</td>
        <td class="num hide-xs">${ord(x.seed)}</td>
        <td>${x.s.complete ? `<b>${x.inPO ? finishLabel(x.place) : `${ord(x.place)} · missed playoffs`}</b>${x.path.length ? `<div class="muted small">${x.path.join(", ")}</div>` : ""}` : `<span class="pill live">Live</span><div class="muted small">${ord(x.seed)} in the standings</div>`}</td></tr>`).join("")}
      </tbody></table>
      <p class="note">Seed = regular-season finish (win %, then points for). Places 1–6 come from the playoff bracket; 7–10 from the regular season. Playoff record counts championship-bracket games only (not the 3rd/5th-place games). *2022 scoring ran high (charter §9.1).</p>`;

    /* ---- Team record book ---- */
    renderRecordBook($("#th-records"), recordCategories(ctx, rid), recordNote(ctx));

    /* ---- Head-to-head vs every other franchise ---- */
    const inWB = (x) => (x.s.winners_bracket || []).some((m) => x.s.playoff_week_start + m.r - 1 === x.wk && [m.t1, m.t2].includes(x.rid) && [m.t1, m.t2].includes(x.opp));
    const h2h = [...teams.values()].filter((o) => o.rosterId !== rid).map((o) => {
      const games = scores.filter((x) => x.rid === rid && x.opp === o.rosterId);
      const reg = games.filter((x) => !x.playoff), po = games.filter((x) => x.playoff && inWB(x));
      const c = (arr, r) => arr.filter((x) => x.res === r).length;
      const counted = [...reg, ...po];
      const last = [...games].sort((a, b) => b.s.season - a.s.season || b.wk - a.wk)[0];
      const prior = [...new Set(seasons.map((s) => s.owners[o.rosterId]?.name))].filter((n) => n && n !== o.owner);
      return { o, prior, rw: c(reg, "W"), rl: c(reg, "L"), rt: c(reg, "T"), pw: c(po, "W"), pl: c(po, "L"), n: counted.length,
        w: c(counted, "W") + c(counted, "T") / 2, pf: counted.reduce((a, x) => a + x.pts, 0), pa: counted.reduce((a, x) => a + x.oppPts, 0), last };
    }).sort((a, b) => b.w / Math.max(1, b.n) - a.w / Math.max(1, a.n) || b.n - a.n);
    $("#th-h2h").innerHTML = `<table><thead><tr><th>Opponent</th><th class="num hide-xs">Reg. season</th><th class="num hide-xs">Playoffs</th><th class="num">Overall</th><th class="num hide-xs">Avg score</th><th class="hide-xs">Last meeting</th></tr></thead><tbody>
      ${h2h.map((h) => {
        const ow = h.rw + h.pw, ol = h.rl + h.pl, share = h.n ? h.w / h.n : 0;
        return `<tr class="${h.o.isMe ? "me" : ""}"><td>${teamChip(h.o, { link: true, sub: "@" + esc(h.o.owner) + (h.prior.length ? ` · was ${h.prior.map(esc).join(", ")}` : "") })}</td>
        <td class="num hide-xs">${recordStr(h.rw, h.rl, h.rt)}</td><td class="num hide-xs">${h.pw + h.pl ? `${h.pw}-${h.pl}` : '<span class="muted">–</span>'}</td>
        <td class="num"><b>${recordStr(ow, ol, h.rt)}</b><span class="h2h-bar" title="${pct(share)}"><i style="width:${(share * 100).toFixed(0)}%"></i></span><div class="muted small show-xs">Reg ${recordStr(h.rw, h.rl, h.rt)}${h.pw + h.pl ? ` · PO ${h.pw}-${h.pl}` : ""}</div></td>
        <td class="num hide-xs">${h.n ? `${fmt(h.pf / h.n, 1)}–${fmt(h.pa / h.n, 1)}` : "–"}</td>
        <td class="hide-xs small">${h.last ? `<b class="${h.last.res === "W" ? "" : "muted"}">${h.last.res}</b> ${fmt(h.last.pts)}–${fmt(h.last.oppPts)} <span class="muted">· ${h.last.s.season} Wk ${h.last.wk}${h.last.playoff ? (inWB(h.last) ? " (playoffs)" : " (consolation)") : ""}</span>` : "–"}</td></tr>`;
      }).join("")}</tbody></table>
      <p class="note">Results count for the franchise, including seasons under a former manager. Regular season plus championship-bracket playoff games (3rd/5th-place games included); toilet-bowl games are left out of the records but can show as the last meeting. ${ctx.league.season} games through Week ${ctx.done} included.</p>`;
    $("#updated").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
});
