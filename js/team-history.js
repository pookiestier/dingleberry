/* Team History: one franchise (Sleeper roster slot) across every season.
   A franchise keeps its roster_id when it changes hands, so a former manager's seasons count here,
   shown under the name that manager used that season ("now @x" marks the hand-off). */
boot(async () => {
  const ctx = await loadLeagueHistory();
  const { teams, seasons, scores } = ctx;
  const list = [...teams.values()].sort((a, b) => a.teamName.localeCompare(b.teamName, undefined, { sensitivity: "base" }));
  const sel = $("#team-pick");
  sel.innerHTML = list.map((t) => `<option value="${t.rosterId}">${esc(t.teamName)} · @${esc(t.owner)}</option>`).join("");
  const fromUrl = () => { const q = +new URLSearchParams(location.search).get("team"); return teams.has(q) ? q : (list.find((t) => t.isMe) || list[0]).rosterId; };
  let rid = fromUrl();
  sel.onchange = () => { rid = +sel.value; history.pushState(null, "", `?team=${rid}`); render(); };
  window.onpopstate = () => { rid = fromUrl(); render(); };
  render();

  function render() {
    sel.value = rid;
    const t = teams.get(rid);
    document.title = `${t.teamName} · Team History · Dingleberry League`;
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
