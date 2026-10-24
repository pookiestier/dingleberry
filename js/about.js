/* About page: league intro and the lore article, which lives in data/about/lore.md so it
   can be edited without touching code. The Markdown subset: # title, ## chapter, ### sub,
   paragraphs, "- " lists, **bold**, *italic*, "> " quotes, and one
   ":::ledger Title" … ":::" box (holding a | table | and notes) shown as a sidebar on desktop. */
(function () {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>");
  const slug = (s) => "ch-" + s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

  function md(src) {
    const out = [], toc = []; let list = null, para = [], table = null, box = null;
    const sink = () => (box ? box.body : out);
    const flushP = () => { if (para.length) { sink().push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
    const flushL = () => { if (list) { sink().push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`); list = null; } };
    const flushT = () => {
      if (!table) return;
      const rows = table.filter((r) => !/^\|?\s*:?-{2,}/.test(r)).map((r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      const [head, ...body] = rows;
      sink().push(`<div class="table-wrap"><table class="ledger-table"><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>
        <tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      table = null;
    };
    const flushAll = () => { flushP(); flushL(); flushT(); };
    for (const raw of src.split(/\r?\n/)) {
      const line = raw.trim(); let m;
      if ((m = line.match(/^:::(\w+)\s*(.*)$/))) { flushAll(); box = { kind: m[1], title: m[2], body: [] }; continue; }
      if (line === ":::" && box) {
        flushAll();
        out.push(`<div class="lore-box lore-${box.kind}" data-box="${box.kind}"><h3>${inline(box.title)}</h3>${box.body.join("\n")}</div>`);
        box = null; continue;
      }
      if (!line) { flushAll(); continue; }
      if (line.startsWith("|")) { flushP(); flushL(); (table ||= []).push(line); continue; }
      flushT();
      if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
        flushP(); flushL();
        const lvl = m[1].length, txt = m[2];
        if (lvl === 1) sink().push(`<h2 class="lore-title">${inline(txt)}</h2>`);
        else if (lvl === 2 && !out.some((x) => x.includes("lore-chapter")) && !toc.length && out.length === 1) sink().push(`<p class="lore-dek">${inline(txt)}</p>`);
        else if (lvl === 2) { const id = slug(txt); toc.push([id, txt]); sink().push(`<h3 class="lore-chapter" id="${id}">${inline(txt)}</h3>`); }
        else sink().push(`<h4>${inline(txt)}</h4>`);
      }
      else if ((m = line.match(/^>\s?(.*)$/))) { flushP(); flushL(); sink().push(`<blockquote>${inline(m[1])}</blockquote>`); }
      else if ((m = line.match(/^[-*]\s+(.*)$/))) { flushP(); (list ||= []).push(m[1]); }
      else if (/^[—–]\s/.test(line)) { flushAll(); sink().push(`<p class="lore-sign">${inline(line)}</p>`); }
      else { flushL(); para.push(line); }
    }
    flushAll();
    return { html: out.join("\n"), toc };
  }

  // On wide screens the ledger box sits in the sidebar; on narrow ones it stays in the story.
  function placeLedger() {
    const box = document.querySelector('[data-box="ledger"]');
    if (!box) return;
    if (!box._home) { box._home = document.createComment("ledger"); box.before(box._home); }
    const wide = window.matchMedia("(min-width: 1000px)").matches;
    if (wide) document.getElementById("lore-aside").append(box);
    else box._home.after(box);
  }

  boot(async () => {
    const lore = document.getElementById("lore");
    const r = await fetch("data/about/lore.md", { cache: "no-cache" });
    if (!r.ok) throw new Error(`lore.md ${r.status}`);
    const { html, toc } = md(await r.text());
    lore.innerHTML = html;
    document.getElementById("lore-toc").innerHTML = toc
      .map(([id, t]) => `<a href="#${id}">${esc(t.split("·")[0].trim())}<span>${esc((t.split("·")[1] || "").trim())}</span></a>`).join("");
    placeLedger();
    window.matchMedia("(min-width: 1000px)").addEventListener("change", placeLedger);

    // Live commissioner line (team name/avatar can change; Sleeper is the source of truth)
    try {
      const { teams, league } = await loadLeague();
      const me = [...teams.values()].find((t) => t.isMe);
      if (me) document.getElementById("about-commish").innerHTML =
        `<span class="muted small">Commissioner</span>${teamChip(me, { link: true, sub: `Lucas R · @${esc(me.owner)}` })}`;
      const up = document.getElementById("updated"); if (up) up.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (e) { /* static commissioner line stays */ }
  });
})();
