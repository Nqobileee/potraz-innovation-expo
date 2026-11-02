(() => {
  const { albums } = window.GALLERY;
  const $ = (sel) => document.querySelector(sel);

  const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>';
  const ICON_DL = '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>';

  // Flatten photos so every one has a stable global index.
  const photos = [];
  albums.forEach((album) => album.photos.forEach((p) => photos.push({ ...p, album })));

  const selected = new Set();
  let activeTab = "all";
  let selecting = false;
  let lastClicked = null;
  let lbIndex = -1;

  const url = (path) => encodeURI(path);
  const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + " GB" : (b / 1e6).toFixed(1) + " MB");
  const visible = () => photos.filter((p) => activeTab === "all" || p.album.id === activeTab);

  /* ---------- Render ---------- */
  function renderStats() {
    const total = photos.reduce((n, p) => n + p.size, 0);
    $("#stats").innerHTML = `
      <span class="stat"><strong>${photos.length}</strong> photos</span>
      <span class="stat"><strong>${albums.length}</strong> albums</span>
      <span class="stat"><strong>${fmtSize(total)}</strong> full resolution</span>`;
  }

  function renderTabs() {
    const tabs = [{ id: "all", title: "All photos", count: photos.length }]
      .concat(albums.map((a) => ({ id: a.id, title: a.title, count: a.photos.length })));
    $("#tabs").innerHTML = tabs
      .map((t) => `<button class="tab" role="tab" data-tab="${t.id}" aria-selected="${t.id === activeTab}">${t.title}<span>${t.count}</span></button>`)
      .join("");
  }

  function renderAlbums() {
    let i = 0;
    $("#albums").innerHTML = albums
      .map((album) => `
        <section class="album" data-album="${album.id}">
          <div class="album-head">
            <h2>${album.title}<small>${album.photos.length} photos</small></h2>
            <button class="album-select" data-select-album="${album.id}">Select album</button>
          </div>
          <div class="grid">
            ${album.photos.map((p) => {
              const idx = i++;
              return `<div class="tile" tabindex="0" data-i="${idx}" style="--r:${(p.w / p.h).toFixed(4)}">
                <img src="${url(p.thumb)}" alt="${album.title} – ${p.name}" loading="lazy" decoding="async" width="${p.w}" height="${p.h}" />
                <button class="tile-check" data-check aria-label="Select ${p.name}">${ICON_CHECK}</button>
                <a class="tile-dl" href="${url(p.src)}" download="${p.name}" aria-label="Download ${p.name}" data-dl>${ICON_DL}</a>
              </div>`;
            }).join("")}
          </div>
        </section>`)
      .join("");

    document.querySelectorAll(".tile img").forEach((img) => {
      if (img.complete) img.classList.add("loaded");
      else img.addEventListener("load", () => img.classList.add("loaded"), { once: true });
    });
  }

  function applyTab() {
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", t.dataset.tab === activeTab));
    document.querySelectorAll(".album").forEach((s) => (s.hidden = activeTab !== "all" && s.dataset.album !== activeTab));
  }

  /* ---------- Selection ---------- */
  function syncSelection() {
    document.querySelectorAll(".tile").forEach((t) => t.classList.toggle("selected", selected.has(+t.dataset.i)));
    $("#selCount").textContent = selected.size;
    $("#selDownload").disabled = selected.size === 0;
    $("#selbar").classList.toggle("show", selecting || selected.size > 0);
    document.body.classList.toggle("selecting", selecting);
    $("#selectModeBtn").setAttribute("aria-pressed", selecting);
    $("#selectModeBtn span").textContent = selecting ? "Done" : "Select";
    document.querySelectorAll("[data-select-album]").forEach((b) => {
      const album = albums.find((a) => a.id === b.dataset.selectAlbum);
      const all = photos.every((p, i) => p.album !== album || selected.has(i));
      b.textContent = all ? "Deselect album" : "Select album";
    });
    if (lbIndex >= 0) $("#lbSelect").classList.toggle("active", selected.has(lbIndex));
  }

  function setSelecting(on) {
    selecting = on;
    if (!on) selected.clear();
    syncSelection();
  }

  function toggle(i, shift) {
    if (shift && lastClicked !== null) {
      // Range-select across the photos currently shown.
      const order = visible().map((p) => photos.indexOf(p));
      const [a, b] = [order.indexOf(lastClicked), order.indexOf(i)].sort((x, y) => x - y);
      if (a >= 0) order.slice(a, b + 1).forEach((k) => selected.add(k));
    } else if (selected.has(i)) {
      selected.delete(i);
    } else {
      selected.add(i);
    }
    lastClicked = i;
    if (selected.size > 0) selecting = true;
    syncSelection();
  }

  /* ---------- Downloads ---------- */
  let toastTimer;
  function toast(text, progress) {
    clearTimeout(toastTimer);
    const el = $("#toast");
    $("#toastText").textContent = text;
    el.classList.toggle("no-progress", progress === undefined);
    if (progress !== undefined) $("#progressBar").style.width = `${Math.round(progress * 100)}%`;
    el.classList.add("show");
  }
  function hideToast(delay = 2200) {
    toastTimer = setTimeout(() => $("#toast").classList.remove("show"), delay);
  }

  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  function directDownload(p) {
    const a = document.createElement("a");
    a.href = url(p.src);
    a.download = p.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function downloadSelected() {
    const items = [...selected].sort((a, b) => a - b).map((i) => photos[i]);
    if (!items.length) return;
    if (items.length === 1) return directDownload(items[0]);

    const btn = $("#selDownload");
    btn.disabled = true;
    const totalBytes = items.reduce((n, p) => n + p.size, 0);

    try {
      if (!window.JSZip) throw new Error("JSZip unavailable");
      const zip = new JSZip();
      let done = 0;
      // Fetch a few at a time to keep things quick without flooding the connection.
      const queue = items.slice();
      const worker = async () => {
        while (queue.length) {
          const p = queue.shift();
          const res = await fetch(url(p.src));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          zip.folder(p.album.title).file(p.name, await res.blob(), { binary: true });
          done++;
          toast(`Fetching photos… ${done} / ${items.length}`, (done / items.length) * 0.85);
        }
      };
      toast(`Preparing ${items.length} photos (${fmtSize(totalBytes)})…`, 0);
      await Promise.all(Array.from({ length: 4 }, worker));

      // JPEGs are already compressed, so just store them.
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" }, (m) =>
        toast("Building zip…", 0.85 + (m.percent / 100) * 0.15));
      saveBlob(blob, `Expo-2026-photos-${items.length}.zip`);
      toast(`Downloaded ${items.length} photos`, 1);
      hideToast();
    } catch (err) {
      // Fallback (e.g. opened from file://): trigger individual downloads.
      console.warn("Zip download failed, falling back to individual files:", err);
      toast(`Downloading ${items.length} photos individually…`);
      for (const p of items) {
        directDownload(p);
        await new Promise((r) => setTimeout(r, 350));
      }
      hideToast();
    } finally {
      btn.disabled = selected.size === 0;
    }
  }

  /* ---------- Lightbox ---------- */
  function openLightbox(i) {
    lbIndex = i;
    const p = photos[i];
    const order = visible();
    const pos = order.indexOf(p);
    const img = $("#lbImg");
    const low = $("#lbThumb");

    low.src = url(p.thumb);
    img.classList.remove("loaded");
    $("#lbSpinner").classList.remove("hide");
    img.onload = () => {
      if (lbIndex !== i) return;
      img.classList.add("loaded");
      $("#lbSpinner").classList.add("hide");
    };
    img.src = url(p.src);
    img.alt = low.alt = `${p.album.title} – ${p.name}`;

    $("#lbCaption").innerHTML = `<b>${p.album.title}</b> · ${pos + 1} of ${order.length} · ${fmtSize(p.size)}`;
    const dl = $("#lbDownload");
    dl.href = url(p.src);
    dl.download = p.name;
    $("#lbSelect").classList.toggle("active", selected.has(i));

    const lb = $("#lightbox");
    if (!lb.classList.contains("open")) {
      lb.classList.add("open");
      lb.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
    }
    // Warm the cache for neighbours.
    [order[pos + 1], order[pos - 1]].forEach((n) => n && (new Image().src = url(n.src)));
  }

  function closeLightbox() {
    const lb = $("#lightbox");
    lb.classList.remove("open");
    lb.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    document.querySelector(`.tile[data-i="${lbIndex}"]`)?.focus({ preventScroll: true });
    lbIndex = -1;
  }

  function step(dir) {
    const order = visible();
    const pos = order.indexOf(photos[lbIndex]);
    const next = order[(pos + dir + order.length) % order.length];
    openLightbox(photos.indexOf(next));
  }

  /* ---------- Events ---------- */
  $("#tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    activeTab = tab.dataset.tab;
    applyTab();
    const top = $("#gallery").getBoundingClientRect().top + scrollY - 70;
    if (scrollY > top) scrollTo({ top, behavior: "smooth" });
  });

  $("#albums").addEventListener("click", (e) => {
    const albumBtn = e.target.closest("[data-select-album]");
    if (albumBtn) {
      const id = albumBtn.dataset.selectAlbum;
      const idx = photos.map((p, i) => (p.album.id === id ? i : -1)).filter((i) => i >= 0);
      const all = idx.every((i) => selected.has(i));
      idx.forEach((i) => (all ? selected.delete(i) : selected.add(i)));
      selecting = selected.size > 0 || selecting;
      return syncSelection();
    }
    const tile = e.target.closest(".tile");
    if (!tile) return;
    if (e.target.closest("[data-dl]")) return;
    const i = +tile.dataset.i;
    if (e.target.closest("[data-check]") || selecting || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      toggle(i, e.shiftKey);
    } else {
      openLightbox(i);
    }
  });

  $("#albums").addEventListener("keydown", (e) => {
    const tile = e.target.closest(".tile");
    if (!tile || e.target !== tile) return;
    if (e.key === "Enter") openLightbox(+tile.dataset.i);
    if (e.key === " ") { e.preventDefault(); toggle(+tile.dataset.i, e.shiftKey); }
  });

  $("#selectModeBtn").addEventListener("click", () => setSelecting(!selecting));
  $("#selAll").addEventListener("click", () => {
    visible().forEach((p) => selected.add(photos.indexOf(p)));
    selecting = true;
    syncSelection();
  });
  $("#selClear").addEventListener("click", () => setSelecting(false));
  $("#selDownload").addEventListener("click", downloadSelected);

  $("#lbClose").addEventListener("click", closeLightbox);
  $("#lbPrev").addEventListener("click", () => step(-1));
  $("#lbNext").addEventListener("click", () => step(1));
  $("#lbSelect").addEventListener("click", () => toggle(lbIndex, false));
  $("#lightbox").addEventListener("click", (e) => {
    if (e.target.classList.contains("lb-stage") || e.target.id === "lightbox") closeLightbox();
  });

  document.addEventListener("keydown", (e) => {
    if (lbIndex >= 0) {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key.toLowerCase() === "s") toggle(lbIndex, false);
      else if (e.key.toLowerCase() === "d") $("#lbDownload").click();
    } else if (e.key === "Escape" && (selecting || selected.size)) {
      setSelecting(false);
    }
  });

  // Swipe between photos on touch screens.
  let touchX = null;
  $("#lightbox").addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
  $("#lightbox").addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    touchX = null;
  });

  $("#copyEmail").addEventListener("click", async () => {
    const email = "nqobilemuyambiri@gmail.com";
    try {
      await navigator.clipboard.writeText(email);
      toast("Email address copied");
    } catch {
      toast(email);
    }
    hideToast(1800);
  });

  renderStats();
  renderTabs();
  renderAlbums();
  applyTab();
  syncSelection();
})();
