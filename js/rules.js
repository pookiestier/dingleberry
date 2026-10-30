/* Rules page: the charter text is static HTML (built from Dingleberry-Dynasty-League-Charter.docx by
   scripts/build_constitution.py). This script adds a live check of the charter's key
   numbers against the league's actual Sleeper settings, so any drift is obvious. */
boot(async () => {
  const [league, users] = await Promise.all([sleeper(`/league/${LEAGUE_ID}`), sleeper(`/league/${LEAGUE_ID}/users`)]);
  const st = league.settings, sc = league.scoring_settings || {};
  const slots = (pos) => league.roster_positions.filter((p) => p === pos).length;
  const commish = users.find((u) => u.is_owner);
  const waiverNames = { 0: "Rolling", 1: "Reverse standings", 2: "FAAB" };
  const starters = ["QB", "RB", "WR", "TE", "FLEX", "K", "DL", "LB", "DB", "IDP_FLEX"].map((p) => `${slots(p)} ${p.replace("_", " ")}`).join(" · ");

  // [label, what the charter says, what Sleeper says, does it match?]
  const checks = [
    ["Teams", "10", st.num_teams, st.num_teams === 10],
    ["Starting lineup (§3.1)", "QB, 2 RB, 2 WR, TE, 2 FLEX, K, DL, LB, DB, 2 IDP FLEX", starters,
      slots("QB") === 1 && slots("RB") === 2 && slots("WR") === 2 && slots("TE") === 1 && slots("FLEX") === 2 && slots("K") === 1 && slots("DL") === 1 && slots("LB") === 1 && slots("DB") === 1 && slots("IDP_FLEX") === 2],
    ["Bench slots (§3.1)", "10", slots("BN"), slots("BN") === 10],
    ["Injured reserve (§3.2)", "6 slots", `${st.reserve_slots} slots`, st.reserve_slots === 6],
    ["Taxi squad (§3.3)", "5 slots, players with ≤ 2 years", `${st.taxi_slots} slots, ${st.taxi_years} years`, st.taxi_slots === 5 && st.taxi_years === 2],
    ["Rookie draft rounds (§1.2)", "4", st.draft_rounds, st.draft_rounds === 4],
    ["Waivers (§4.1)", "Reverse standings, 2-day clear", `${waiverNames[st.waiver_type] ?? st.waiver_type}, ${st.waiver_clear_days}-day clear`, st.waiver_type === 1 && st.waiver_clear_days === 2],
    ["Trade deadline (§4.3)", "Week 11", `Week ${st.trade_deadline}`, st.trade_deadline === 11],
    ["Trade review (§4.3)", "2 days", `${st.trade_review_days} days`, st.trade_review_days === 2],
    ["Draft pick trading (§4.3)", "Allowed", st.pick_trading ? "Allowed" : "Off", !!st.pick_trading],
    ["Playoffs (§6.0)", "Top 6, start Week 15", `Top ${st.playoff_teams}, start Week ${st.playoff_week_start}`, st.playoff_teams === 6 && st.playoff_week_start === 15],
    ["Reception (§2.0)", "1 pt (full PPR)", `${sc.rec} pt`, sc.rec === 1],
    ["Passing TD / yards (§2.0)", "6 pts · 1 per 30 yds", `${sc.pass_td} pts · 1 per ${Math.round(1 / sc.pass_yd)} yds`, sc.pass_td === 6 && Math.round(1 / sc.pass_yd) === 30],
    ["Long field goals (§2.0)", "50–59 yds = 5 pts · 60+ yds = 6 pts", `50–59 yds = ${sc.fgm_50_59} pts · 60+ yds = ${sc.fgm_60p} pts`, sc.fgm_50_59 === 5 && sc.fgm_60p === 6],
    ["Commissioner (§5.3)", "Lucas R (@rudedog12)", commish ? "@" + commish.display_name : "?", commish && commish.display_name === "rudedog12"],
  ];
  $("#settings-check").innerHTML = checks.map(([label, doc, live, ok]) =>
    `<li><span class="${ok ? "ok" : "warn"}">${ok ? "✓" : "!"}</span><span><b>${esc(label)}</b><br><span class="muted small">Charter: ${esc(doc)}</span></span><span>${esc(String(live))}</span></li>`).join("") +
    `<li class="muted small" style="border:0">✓ = Sleeper matches the charter. ! = worth a look. Read from Sleeper when this page loaded.</li>`;
  const off = checks.filter((c) => !c[3]).length;
  const pill = $("#check-pill");
  pill.textContent = off ? `${off} to review` : `✓ All ${checks.length} match`;
  pill.className = off ? "pill warn" : "pill final";
  pill.title = "Charter numbers compared with the league's current Sleeper settings";
  $("#updated").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
});
