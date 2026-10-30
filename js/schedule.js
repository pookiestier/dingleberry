/* League Schedule: one week's matchups as scorecards, plus the whole season at a glance.
   Data from js/schedule-data.js (live Sleeper for the current season, history.json for 2022–2025). */
boot(async () => {
  const [{ seasons, currentWeek, state }, gotw] = await Promise.all([loadSchedules(), loadGotw()]);
  const ss = $("#sch-season"), ws = $("#sch-week");
  ss.innerHTML = seasons.map((x) => `<option value="${x.season}">${x.season}${seasonOptSuffix(x)}</option>`).join("");
  const q = new URLSearchParams(location.search);
  let S = seasons.find((x) => x.season === q.get("season")) || seasons[0];
  let wk = +q.get("week") || (S === seasons[0] ? currentWeek : S.W + 2);

  const weekOpts = () => { ws.innerHTML = S.weeks.map((w) => `<option value="${w.wk}">${w.playoff ? `Wk ${w.wk} · ${["Playoffs Rd 1", "Semifinals", "Championship"][w.round - 1]}` : `Week ${w.wk}`}${!S.complete && w.wk === S.liveWeek ? (w.status === "live" ? " (live)" : w.status === "upcoming" ? " (up next)" : " (this week)") : ""}${(w.special || []).map((x) => ` · ${x.tag}`).join("")}</option>`).join(""); };
  const clamp = () => { const max = S.weeks[S.weeks.length - 1].wk; wk = Math.min(Math.max(1, wk), max); };
  const go = (push = true) => {
    clamp();
    const url = `?season=${S.season}&week=${wk}`;
    push ? history.pushState(null, "", url) : history.replaceState(null, "", url);
    render();
  };
  ss.onchange = () => { S = seasons.find((x) => x.season === ss.value); weekOpts(); go(); };
  ws.onchange = () => { wk = +ws.value; go(); };
  $("#sch-prev").onclick = () => { wk--; go(); };
  $("#sch-next").onclick = () => { wk++; go(); };
  window.onpopstate = () => { const p = new URLSearchParams(location.search); S = seasons.find((x) => x.season === p.get("season")) || seasons[0]; weekOpts(); wk = +p.get("week") || currentWeek; go(false); };
  weekOpts();
  go(false);

  function side(g, rid, pts) {
    const o = S.owners[rid] || {};
    const win = g.winner === rid, lose = g.status === "final" && !g.tie && !win;
    return `<div class="sc-side ${win ? "win" : ""} ${lose ? "lose" : ""}">
      <img class="avatar" src="${avatarUrl(o.avatar)}" alt="" loading="lazy">
      <div class="team-names"><span class="team-name"><a class="tlink" href="${schTeamHref(rid)}">${esc(schName(S, rid))}</a></span><span class="owner">@${esc(o.name || "?")}</span></div>
      <div class="sc-pts">${g.status === "upcoming" ? "–" : fmt(pts)}${win ? ' <span class="res W">W</span>' : ""}${g.status === "live" && g.left ? `<span class="m-left">${schLeft(g.left[rid])}</span>` : ""}</div></div>`;
  }

  /* "Last meeting" line for Week 1 cards (names and score as they were that season) */
  function lastMeet(g) {
    const m = g.lastMeet;
    if (!m) return `<div class="sc-last"><b>Last meeting:</b> none. ${+S.season === 2022 ? "2022 was the startup season." : "These franchises had never played before."}</div>`;
    const P = m.S, x = m.g;
    const nm = (rid) => esc(schName(P, rid));
    const winTag = (rid) => x.winner === rid ? "win" : "";
    return `<div class="sc-last"><b>Last meeting:</b> ${P.season} Wk ${x.wk}${x.label ? ` · ${esc(x.label)}` : ""}<br>
      <span class="${winTag(x.a)}">${nm(x.a)} ${fmt(x.ap)}</span> – <span class="${winTag(x.b)}">${fmt(x.bp)} ${nm(x.b)}</span>${x.tie ? " (tie)" : ""}</div>`;
  }

  function card(g) {
    let tag = g.label ? `<span class="sched-tag ${g.kind === "tb" ? "tb" : "po"}">${esc(g.label)}</span>` : "";
    if (g.rivalry) tag = `<span class="sched-tag rival">⚔️ ${esc(g.rivalry.name)}</span>`;
    else if (S.rematch && g.wk === S.rematchWeek) tag = `<span class="sched-tag rematch">🔁 Rematch</span>`;
    const margin = g.status === "final" && !g.tie ? `<span class="muted small">by ${fmt(Math.abs(g.ap - g.bp))}</span>` : g.tie ? '<span class="muted small">Tie</span>' : "";
    const pk = gotw(S.season, g.wk, g.a, g.b);
    if (pk) tag = `<span class="sc-tags"><a class="sched-tag gotw" href="${gotwHref(pk)}">⭐ Game of the Week</a>${tag}</span>`;
    const rivalLine = g.rivalry ? `<div class="sc-h2h">${schSeries(g.rivalry.rec, schName(S, g.a), schName(S, g.b))}${g.rivalry.rec.n ? ` <span class="muted">· ${g.rivalry.rec.n} game${g.rivalry.rec.n === 1 ? "" : "s"}</span>` : ""}</div>` : "";
    return `<div class="card sc-card ${g.kind === "tb" ? "sc-tb" : g.label ? "sc-po" : ""} ${g.p === 1 && g.kind !== "tb" ? "sc-final" : ""} ${g.rivalry ? "sc-rival" : ""} ${S.rematch && g.wk === S.rematchWeek ? "sc-rematch" : ""} ${pk ? "sc-gotw" : ""}">
      <div class="sc-top">${tag || `<span class="muted small">Week ${g.wk}</span>`}<span class="sc-st">${margin} ${schStatusPill(g.status)}</span></div>
      ${rivalLine}${side(g, g.a, g.ap)}${side(g, g.b, g.bp)}${S.rematch && g.wk === S.rematchWeek ? lastMeet(g) : ""}</div>`;
  }

  function specialNote() {
    const bits = [`🔒 Trades lock after Week ${S.tradeDeadline} (Sleeper league setting).`];
    if (S.rematch) bits.push(`🔁 Week ${S.rematchWeek} is Rematch Week: every game repeats both teams' last game of ${+S.season - 1}.`);
    if (S.rivalryWeek) bits.push(S.rivalryCount ? `⚔️ Week ${S.rivalryWeek} is Rivalry Week: ${S.rivalryCount} rivalry game${S.rivalryCount === 1 ? "" : "s"}; the head-to-head counts every game the two franchises (roster slots) have played, including playoff, placement and Toilet Bowl games.` : `⚔️ Week ${S.rivalryWeek} is Rivalry Week, but no rivalry pairings are scheduled that week.`);
    return bits.join(" ");
  }

  function render() {
    ss.value = S.season; ws.value = wk;
    $("#sch-prev").disabled = wk <= 1;
    $("#sch-next").disabled = wk >= S.weeks[S.weeks.length - 1].wk;
    const w = S.weeks.find((x) => x.wk === wk);
    $("#sch-week-title").innerHTML = `${w.playoff ? "🏆" : "🏈"} ${S.season} · ${esc(schRoundName(w))} ${schStatusPill(w.status)}`;
    $("#sch-banners").innerHTML = schSpecialBanners(S, w, state);
    const isG = (g) => !!gotw(S.season, g.wk, g.a, g.b);
    let html = [...w.games.filter(isG), ...w.games.filter((g) => !isG(g))].map(card).join("");
    if (w.byes.length) html += `<div class="card sc-card sc-bye"><div class="sc-top"><span class="sched-tag po">Round 1 byes</span></div>
      ${w.byes.map((rid) => `<div class="sc-side"><img class="avatar" src="${avatarUrl(S.owners[rid]?.avatar)}" alt="" loading="lazy"><div class="team-names"><span class="team-name"><a class="tlink" href="${schTeamHref(rid)}">${esc(schName(S, rid))}</a></span><span class="owner">@${esc(S.owners[rid]?.name || "?")}</span></div><div class="sc-pts muted small">Bye</div></div>`).join("")}
      <p class="muted small">Top-2 seeds skip round 1.</p></div>`;
    if (w.tbd) html = `<div class="card sc-tbd"><b>${esc(schRoundName(w))}</b><p class="muted">Playoffs run Weeks ${S.W}–${S.W + 2}: the top 6 make the playoffs (seeds 1–2 get a bye) and the bottom 4 play the Toilet Bowl. Matchups are set once Week ${S.W - 1} is final.</p></div>`;
    $("#sch-cards").innerHTML = html || '<div class="card muted">No games this week.</div>';
    document.title = `${S.season} ${schRoundName(w)} · Schedule · Dingleberry League`;

    /* ---- Full season ---- */
    $("#sch-season-title").innerHTML = `📋 ${S.season} Full Season`;
    $("#sch-grid").innerHTML = S.weeks.map((x) => {
      const lines = x.tbd ? `<div class="muted small sg-tbd">Set after Week ${S.W - 1}</div>` : x.games.map((g) => {
        const nm = (rid) => `<span class="sg-n ${g.winner === rid ? "win" : ""}" title="${esc(schName(S, rid))} · @${esc(S.owners[rid]?.name || "?")}">${esc(schName(S, rid))}</span>`;
        const pts = (p) => g.status === "upcoming" ? "–" : fmt(p, 1);
        const lab = g.rivalry ? `⚔️ ${g.rivalry.name}` : g.label;
        return `<div class="sg-g ${g.rivalry ? "rival" : g.kind === "tb" ? "tb" : g.label ? "po" : ""}">${lab ? `<div class="sg-lab">${esc(lab)}</div>` : ""}<div class="sg-row">${nm(g.a)}<span class="sg-p">${pts(g.ap)}</span><span class="sg-p">${pts(g.bp)}</span>${nm(g.b)}</div></div>`;
      }).join("") + (x.byes.length ? `<div class="muted small sg-bye">Bye: ${x.byes.map((r) => esc(schName(S, r))).join(", ")}</div>` : "");
      return `<button class="sg-week ${x.wk === wk ? "on" : ""} ${x.playoff ? "playoff" : ""} ${schSpecialClass(x)}" data-wk="${x.wk}">
        <div class="sg-head"><b>${x.playoff ? `Wk ${x.wk} · ${["Playoffs Rd 1", "Semifinals", "Championship"][x.round - 1]}` : `Week ${x.wk}`}</b>${x.status !== "final" ? schStatusPill(x.status) : ""}</div>${x.special?.length ? `<div class="sg-tags">${schSpecialTags(x)}</div>` : ""}${lines}</button>`;
    }).join("");
    $("#sch-grid").querySelectorAll(".sg-week").forEach((b) => b.onclick = () => { wk = +b.dataset.wk; go(); window.scrollTo({ top: $(".sch-controls").offsetTop - 80, behavior: "smooth" }); });
    $("#sch-note").innerHTML = S.complete
      ? `${specialNote()} Regular season Weeks 1–${S.W - 1}; playoffs and Toilet Bowl Weeks ${S.W}–${S.W + 2}, labeled from that season's Sleeper brackets. In the Toilet Bowl the loser advances; the highlighted side is the real scoreboard winner. Team names are as used that season; links go to the franchise (roster slot) on Team Info.`
      : `${specialNote()} ${schLiveNote(S)} Later weeks are unplayed. Playoff pairings appear once Week ${S.W - 1} is final.`;
  }
});
