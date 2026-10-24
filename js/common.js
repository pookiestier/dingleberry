/* =========================================================
   Dingleberry League — shared helpers
   - Talks to the public Sleeper API (CORS-enabled, no key needed)
   - Loads local snapshots (data/players.json, data/history.json)
   - Renders the shared header/footer
   ========================================================= */
const LEAGUE_ID = "1326776708950401024";
const API = "https://api.sleeper.app/v1";
const COMMISH_USERNAME = "rudedog12"; // highlighted as "you" in tables

/* ---------- Fetch with a short sessionStorage cache ---------- */
async function getJSON(url, { ttlMinutes = 5 } = {}) {
  const key = "dbl:" + url;
  try {
    const hit = JSON.parse(sessionStorage.getItem(key) || "null");
    if (hit && Date.now() - hit.t < ttlMinutes * 60e3) return hit.d;
  } catch (_) { /* ignore bad cache */ }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} loading ${url}`);
  const data = await res.json();
  try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d: data })); } catch (_) { /* quota */ }
  return data;
}
const sleeper = (path, opts) => getJSON(API + path, opts);
const local = (path) => getJSON(path, { ttlMinutes: 60 });

/* ---------- Formatting ---------- */
const fmt = (n, d = 2) => (n == null || isNaN(n) ? "–" : Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (n) => (n * 100).toFixed(1) + "%";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const recordStr = (w, l, t) => `${w}-${l}${t ? "-" + t : ""}`;
const $ = (sel) => document.querySelector(sel);
const ord = (n) => n + (["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");

function avatarUrl(avatarId) {
  if (!avatarId) return "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#1b2334"/><text x="16" y="21" font-size="14" text-anchor="middle" fill="#8d97ad">?</text></svg>');
  return avatarId.startsWith("http") ? avatarId : `https://sleepercdn.com/avatars/thumbs/${avatarId}`;
}

/* A small "avatar + team name + owner" chip used everywhere */
function teamChip(t, { lg = false, sub } = {}) {
  return `<div class="team">
    <img class="avatar ${lg ? "lg" : ""}" src="${avatarUrl(t.avatar)}" alt="" loading="lazy">
    <div class="team-names"><span class="team-name">${esc(t.teamName)}</span>
    <span class="owner">${sub ?? "@" + esc(t.owner)}</span></div></div>`;
}

/* ---------- Core league data ---------- */
/* Returns { league, state, users, teams: Map(roster_id -> team), standings: [team] } */
async function loadLeague() {
  const [league, users, rosters, state] = await Promise.all([
    sleeper(`/league/${LEAGUE_ID}`),
    sleeper(`/league/${LEAGUE_ID}/users`),
    sleeper(`/league/${LEAGUE_ID}/rosters`),
    sleeper(`/state/nfl`),
  ]);
  const userById = Object.fromEntries(users.map((u) => [u.user_id, u]));
  const teams = new Map();
  for (const r of rosters) {
    const u = userById[r.owner_id] || {};
    const s = r.settings || {};
    teams.set(r.roster_id, {
      rosterId: r.roster_id,
      ownerId: r.owner_id,
      owner: u.display_name || "Open slot",
      teamName: (u.metadata && u.metadata.team_name) || `Team ${u.display_name || r.roster_id}`,
      avatar: (u.metadata && u.metadata.avatar) || u.avatar,
      wins: s.wins || 0, losses: s.losses || 0, ties: s.ties || 0,
      pf: (s.fpts || 0) + (s.fpts_decimal || 0) / 100,
      pa: (s.fpts_against || 0) + (s.fpts_against_decimal || 0) / 100,
      maxPf: (s.ppts || 0) + (s.ppts_decimal || 0) / 100,
      players: r.players || [], starters: r.starters || [], taxi: r.taxi || [], reserve: r.reserve || [],
      isMe: u.display_name === COMMISH_USERNAME,
    });
  }
  return { league, state, users, teams, standings: sortStandings([...teams.values()]) };
}

/* Standings: win% first, then points for (Sleeper's default tiebreak) */
function sortStandings(list) {
  const wp = (t) => { const g = t.wins + t.losses + t.ties; return g ? (t.wins + t.ties / 2) / g : 0; };
  return [...list].sort((a, b) => wp(b) - wp(a) || b.pf - a.pf);
}

/* The week whose scores are "done": current week minus one during the season */
function lastCompletedWeek(state, league) {
  if (league.status === "complete") return (league.settings.playoff_week_start || 15) + 2;
  if (state.season !== league.season || state.season_type !== "regular") return 0;
  return Math.max(0, (state.week || 1) - 1);
}

/* Fetch all matchups for weeks 1..n of the current league: { week: [matchup rows] } */
async function loadMatchups(n) {
  const weeks = Array.from({ length: n }, (_, i) => i + 1);
  const all = await Promise.all(weeks.map((w) => sleeper(`/league/${LEAGUE_ID}/matchups/${w}`)));
  return Object.fromEntries(weeks.map((w, i) => [w, all[i]]));
}

/* Group a week's rows into head-to-head pairs [[a, b], ...] (rows without a matchup_id are skipped) */
function pairUp(rows) {
  const by = {};
  for (const r of rows || []) if (r.matchup_id != null) (by[r.matchup_id] ||= []).push(r);
  return Object.values(by).filter((p) => p.length === 2);
}

let _players = null;
async function loadPlayers() {
  if (!_players) _players = await local("data/players.json");
  return _players;
}
const loadHistory = () => local("data/history.json");

/* Map Sleeper's detailed IDP positions onto the league's slot groups */
function slotPos(p) {
  if (!p) return "?";
  const pos = p.p;
  if (["DE", "DT", "DL"].includes(pos)) return "DL";
  if (["CB", "S", "DB", "SS", "FS"].includes(pos)) return "DB";
  if (["ILB", "OLB", "LB"].includes(pos)) return "LB";
  return pos || "?";
}

/* ---------- Shared header / footer ---------- */
const NAV = [
  ["index.html", "Home"],
  ["teams.html", "Teams"],
  ["power.html", "Power Rankings"],
  ["history.html", "History & Records"],
  ["rules.html", "Constitution"],
  ["dynasty.html", "Rookie Draft & Dynasty"],
];
function renderChrome() {
  const here = location.pathname.split("/").pop() || "index.html";
  const header = document.createElement("header");
  header.className = "site-header";
  header.innerHTML = `<div class="header-inner">
    <a class="brand" href="index.html" aria-label="Dingleberry League home">
      <img class="brand-logo" src="assets/logo-nav.png" alt="" width="52" height="54">
      <span class="brand-text"><span class="brand-name">DINGLE<span>BERRY</span></span>
      <span class="brand-tag">DYNASTY · FULL PPR · IDP · CLINGING ON SINCE 2022</span></span>
    </a>
    <button class="nav-toggle" aria-label="Menu">☰ Menu</button>
    <nav class="nav">${NAV.map(([h, l]) => `<a href="${h}" class="${h === here ? "active" : ""}">${l}</a>`).join("")}</nav>
  </div>`;
  document.body.prepend(header);
  header.querySelector(".nav-toggle").onclick = () => header.querySelector(".nav").classList.toggle("open");

  const footer = document.createElement("footer");
  footer.innerHTML = `<div class="inner">
    <span>Dingleberry League · Commissioner: Lucas R (@rudedog12)</span>
    <span>Live data from the <a href="https://docs.sleeper.com/" target="_blank" rel="noopener">Sleeper API</a> · Updated <span id="updated">just now</span></span>
  </div>`;
  document.body.append(footer);
}
document.addEventListener("DOMContentLoaded", renderChrome);

/* Run a page's async main() and show any error in place */
function boot(main) {
  document.addEventListener("DOMContentLoaded", () => {
    main().catch((e) => {
      console.error(e);
      document.querySelectorAll(".loading").forEach((n) => (n.innerHTML = `<span class="error">Couldn't load data: ${esc(e.message)}</span>`));
    });
  });
}
