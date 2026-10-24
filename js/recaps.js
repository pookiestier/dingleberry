/* Commissioner's recaps: Markdown files in data/recaps/, listed newest-first in
   data/recaps/index.json. Shows the newest by default; ?recap=2026-6 picks one.
   Recaps always use team names; stray "@handle" lines are dropped on render. */
(function () {
  const box = document.getElementById("recap");
  const pill = document.getElementById("recap-week");
  if (!box) return;
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>");

  function md(src) {
    const out = []; let list = null, para = [];
    const flushP = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
    const flushL = () => { if (list) { out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`); list = null; } };
    for (const raw of src.split(/\r?\n/)) {
      const line = raw.trim();
      if (/^@\w+$/.test(line)) continue;                       // no username sublines
      let m;
      if (!line) { flushP(); flushL(); }
      else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
        flushP(); flushL();
        const lvl = m[1].length;
        out.push(lvl === 1 ? `<h3 class="recap-headline">${inline(m[2])}</h3>` : `<h4 class="recap-h">${inline(m[2])}</h4>`);
      }
      else if ((m = line.match(/^[-*]\s+(.*)$/))) { flushP(); (list ||= []).push(m[1]); }
      else if (/^[—–-]{1,2}\s/.test(line)) { flushP(); flushL(); out.push(`<p class="recap-sign">${inline(line)}</p>`); }
      else { flushL(); para.push(line); }
    }
    flushP(); flushL();
    return out.join("\n");
  }

  async function show(list, entry) {
    pill.textContent = `Week ${entry.week} · ${entry.season}`;
    box.innerHTML = `<div class="loading">Loading recap…</div>`;
    try {
      const r = await fetch(`data/recaps/${entry.file}`, { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      box.innerHTML = `<article class="recap-body">${md(await r.text())}</article>`;
    } catch (e) {
      box.innerHTML = `<p class="muted">Couldn't load this recap.</p>`;
    }
    const sel = document.getElementById("recap-select");
    if (sel) sel.value = `${entry.season}-${entry.week}`;
  }

  fetch("data/recaps/index.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then(({ recaps }) => {
      if (!recaps || !recaps.length) { box.innerHTML = `<p class="muted">No recaps yet.</p>`; return; }
      const key = (e) => `${e.season}-${e.week}`;
      const want = new URLSearchParams(location.search).get("recap");
      const first = recaps.find((e) => key(e) === want) || recaps[0];
      const arch = document.getElementById("recap-archive");
      if (arch) {
        arch.innerHTML = `<label for="recap-select">Recap archive</label>
          <select id="recap-select">${recaps.map((e) => `<option value="${key(e)}">${e.season} · Week ${e.week}: ${esc(e.title || "")}</option>`).join("")}</select>`;
        arch.querySelector("select").addEventListener("change", (ev) => {
          const e = recaps.find((x) => key(x) === ev.target.value);
          if (e) { history.replaceState(null, "", `?recap=${key(e)}`); show(recaps, e); }
        });
        arch.hidden = false;
      }
      show(recaps, first);
    })
    .catch(() => { box.innerHTML = `<p class="muted">Couldn't load recaps.</p>`; });
})();
