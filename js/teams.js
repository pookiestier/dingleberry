/* Teams page: one card per roster, players grouped by position */
const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DL", "LB", "DB"];

boot(async () => {
  const [{ teams, standings }, players] = await Promise.all([loadLeague(), loadPlayers()]);

  const playerRow = (id, t) => {
    const p = players[id];
    const pos = slotPos(p);
    const starter = t.starters.includes(id);
    const inj = p && p.inj ? ` <span class="inj">${esc(p.inj.slice(0, 3).toUpperCase())}</span>` : "";
    return `<div class="player ${starter ? "starter" : ""}"><span class="pos ${pos}">${pos}</span>
      <span class="pname">${p ? esc(p.n) : "Player #" + esc(id)}${starter ? ' <span class="star">★</span>' : ""}${inj}</span>
      <span class="team-abbr">${p && p.t ? p.t : "FA"}${p && p.a ? " · " + p.a : ""}</span></div>`;
  };

  $("#teams").innerHTML = standings.map((t, i) => {
    const special = new Set([...t.taxi, ...t.reserve]);
    const active = t.players.filter((id) => !special.has(id));
    const groups = POS_ORDER.map((pos) => {
      const ids = active.filter((id) => slotPos(players[id]) === pos)
        .sort((a, b) => t.starters.includes(b) - t.starters.includes(a));
      return ids.length ? `<div class="pos-group"><div class="pos-label">${pos} · ${ids.length}</div>${ids.map((id) => playerRow(id, t)).join("")}</div>` : "";
    }).join("");
    const extra = (label, ids) => ids.length ? `<div class="pos-group"><div class="pos-label">${label} · ${ids.length}</div>${ids.map((id) => playerRow(id, t)).join("")}</div>` : "";
    return `<div class="card roster-card" id="team-${t.rosterId}">
      <div class="head">${teamChip(t, { lg: true, link: true })}
        <div class="rec"><b>${recordStr(t.wins, t.losses, t.ties)}</b><span class="muted small">${ord(i + 1)} · ${fmt(t.pf, 1)} PF</span></div></div>
      ${groups}${extra("Taxi squad", t.taxi)}${extra("Injured reserve", t.reserve)}
    </div>`;
  }).join("");
  $("#updated").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
});
