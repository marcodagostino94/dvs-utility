import { buildAudioReport, buildVideoReport, excludeEdlRanges, framesToTc, parseEdl, tcToFrames, timelineDuration } from "./parser.js";
import { analyzeWav, loudnessLimits, normalizeWav, parseWav } from "./loudness.js";
import { technicalDuration } from "./technical.js";
import { filterHistoryItems } from "./history.js";

const $ = (selector) => document.querySelector(selector);
const views = {
  home: $("#homeView"), audio: $("#audioView"), video: $("#videoView"), episode: $("#episodeView"),
  calculator: $("#calculatorView"), loudness: $("#loudnessView"), technical: $("#technicalView"),
  history: $("#historyView"), info: $("#infoView")
};
const hasDatabase = Boolean(window.DVS_SUPABASE?.url && window.DVS_SUPABASE?.publishableKey && window.supabase?.createClient);
const db = hasDatabase ? window.supabase.createClient(window.DVS_SUPABASE.url, window.DVS_SUPABASE.publishableKey) : null;

let parsedAudioEdl = null;
let currentAudioFile = null;
let selectedAudioTracks = new Set();
let audioRows = [];
let currentAudioSavedId = null;
let audioBatchItems = [];

let parsedVideoEdl = null;
let currentVideoFile = null;
let selectedVideoTracks = new Set();
let videoRows = [];
let currentVideoSavedId = null;
let videoBatchItems = [];
let episodeBatchItems = [];
let batchSequence = 0;
let historyOrigin = "audio";
let historyItems = [];
let currentTechnicalSavedId = null;
let pendingTechnicalPdfFiles = [];
let technicalHistoryItems = [];
let currentStoredTechnicalPdf = null;
const TECHNICAL_PDF_BUCKET = "technical-sheets-pdf";

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2400);
}

function showView(name) {
  Object.entries(views).forEach(([key, view]) => view.classList.toggle("active", key === name));
  const inAudio = name === "audio" || (name === "history" && historyOrigin === "audio");
  const inVideo = name === "video" || (name === "history" && historyOrigin === "video");
  const inEpisode = name === "episode" || (name === "history" && historyOrigin === "episode");
  $("#openHomeNav").classList.toggle("active", name === "home");
  $("#openAudioNav").classList.toggle("active", inAudio);
  $("#openVideoNav").classList.toggle("active", inVideo);
  $("#openEpisodeNav").classList.toggle("active", inEpisode);
  $("#openCalculatorNav").classList.toggle("active", name === "calculator");
  $("#openLoudnessNav").classList.toggle("active", name === "loudness");
  $("#openTechnicalNav").classList.toggle("active", name === "technical");
  $("#openInfoNav").classList.toggle("active", name === "info");
  $("#iphoneHomeNav").classList.toggle("active", name === "home");
  $("#iphoneAudioNav").classList.toggle("active", inAudio);
  $("#iphoneVideoNav").classList.toggle("active", inVideo);
  $("#iphoneCalculatorNav").classList.toggle("active", name === "calculator");
  $(".iphone-bottom-nav").dataset.active = inVideo ? "2" : name === "calculator" ? "3" : inAudio ? "1" : "0";
  $("#iphoneSectionTitle").textContent = name === "history" ? (historyOrigin === "episode" ? "STORICO PUNTATE" : "STORICO DCP") : name === "audio" ? "DCP AUDIO" : name === "video" ? "DCP VIDEO" : name === "episode" ? "DCP PUNTATE" : name === "calculator" ? "TIMECODE" : name === "loudness" ? "LOUDNESS" : name === "technical" ? "SCHEDA TECNICA" : name === "info" ? "INFORMAZIONI" : "UTILITY";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function readSavedTracks(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); }
  catch { return []; }
}

function setupDropZone(zone, input, loader) {
  ["dragenter", "dragover"].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.remove("dragover"); }));
  zone.addEventListener("drop", (event) => loader(input.multiple ? [...event.dataTransfer.files] : event.dataTransfer.files[0]));
  input.addEventListener("change", () => loader(input.multiple ? [...input.files] : input.files[0]));
}

function renderTrackButtons(container, tracks, selected, storageKey, toggleButton) {
  container.replaceChildren();
  tracks.forEach((track) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `track-button${selected.has(track) ? " active" : ""}`;
    button.textContent = `${selected.has(track) ? "✓ " : ""}${track}`;
    button.setAttribute("aria-pressed", String(selected.has(track)));
    button.addEventListener("click", () => {
      selected.has(track) ? selected.delete(track) : selected.add(track);
      localStorage.setItem(storageKey, JSON.stringify([...selected]));
      renderTrackButtons(container, tracks, selected, storageKey, toggleButton);
    });
    container.append(button);
  });
  const allSelected = tracks.length > 0 && tracks.every((track) => selected.has(track));
  toggleButton.textContent = allSelected ? "Deseleziona tutte" : "Seleziona tutte";
  if (container.id === "videoTrackGrid") $("#videoTrackSummary").textContent = `${selected.size} di ${tracks.length} piste selezionate. Clicca su una pista per attivarla o disattivarla.`;
}

function cleanRows(rows, type) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => ({
    id: row.id || `${type}-${index}-${Date.now()}`,
    name: String(row.name || "Elemento senza nome"),
    duration: String(row.duration || "00:00:00:00"),
    frames: Number(row.frames || 0),
    ...(type === "video" ? { selected: Boolean(row.selected) } : {})
  }));
}

// IMPORTAZIONE MULTIPLA EDL
function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function reportBatch(type) { return type === "video" ? videoBatchItems : audioBatchItems; }
function batchContainer(type) { return type === "video" ? $("#videoBatchList") : $("#audioBatchList"); }

function batchPayload(item) {
  return {
    title: item.title.trim() || (item.type === "video" ? "DCP Video senza titolo" : "DCP Audio senza titolo"),
    report_type: item.type,
    rows: item.rows.map(({ name, duration, frames, selected }) => ({ name, duration, frames, ...(item.type === "video" ? { selected: Boolean(selected) } : {}) }))
  };
}

async function loadEdlBatch(files, type) {
  const candidates = (Array.isArray(files) ? files : [files]).filter((file) => file && /\.(edl|txt)$/i.test(file.name));
  if (!candidates.length) return toast("Seleziona almeno un file EDL valido");
  const items = [];
  for (const file of candidates) {
    try {
      const parsed = parseEdl(await file.text(), 25);
      if (!parsed.intervals.length) continue;
      const tracks = type === "video" ? parsed.videoTracks : parsed.audioTracks;
      const remembered = type === "audio" ? readSavedTracks("dvs-audio-tracks").filter((track) => tracks.includes(track)) : [];
      items.push({
        id: `batch-${type}-${++batchSequence}`,
        type, file, parsed,
        title: parsed.title || file.name.replace(/\.[^.]+$/, ""),
        selectedTracks: new Set(type === "video" ? tracks : remembered.length ? remembered : tracks),
        rows: [], generated: false, savedId: null, search: ""
      });
    } catch { /* Il singolo file non leggibile viene ignorato. */ }
  }
  if (!items.length) return toast("Nessuno degli EDL selezionati contiene eventi leggibili");
  if (type === "video") {
    videoBatchItems = items; videoEntryGrid.classList.add("hidden"); videoWorkspace.classList.remove("hidden");
    $("#videoFileSummary").classList.add("hidden"); $("#videoControls").classList.add("hidden"); videoResults.classList.add("hidden");
    $("#videoBackButton").classList.remove("hidden"); videoFileInput.value = "";
  } else {
    audioBatchItems = items; audioEntryGrid.classList.add("hidden"); audioWorkspace.classList.remove("hidden");
    $("#audioFileSummary").classList.add("hidden"); $(".work-controls").classList.add("hidden"); audioResults.classList.add("hidden");
    $("#backButton").classList.remove("hidden"); audioFileInput.value = "";
  }
  batchContainer(type).classList.remove("hidden");
  renderBatch(type);
  toast(`${items.length} ${items.length === 1 ? "EDL caricato" : "EDL caricati"} separatamente`);
}

function batchTrackButtons(item, container, toggle) {
  const tracks = item.type === "video" ? item.parsed.videoTracks : item.parsed.audioTracks;
  container.replaceChildren();
  tracks.forEach((track) => {
    const button = makeElement("button", `track-button${item.selectedTracks.has(track) ? " active" : ""}`, `${item.selectedTracks.has(track) ? "✓ " : ""}${track}`);
    button.type = "button"; button.setAttribute("aria-pressed", String(item.selectedTracks.has(track)));
    button.addEventListener("click", () => {
      item.selectedTracks.has(track) ? item.selectedTracks.delete(track) : item.selectedTracks.add(track);
      if (item.type === "audio") localStorage.setItem("dvs-audio-tracks", JSON.stringify([...item.selectedTracks]));
      renderBatch(item.type);
    });
    container.append(button);
  });
  const all = tracks.length > 0 && tracks.every((track) => item.selectedTracks.has(track));
  toggle.textContent = all ? "Deseleziona tutte" : "Seleziona tutte";
  toggle.addEventListener("click", () => {
    item.selectedTracks = new Set(all ? [] : tracks);
    if (item.type === "audio") localStorage.setItem("dvs-audio-tracks", JSON.stringify([...item.selectedTracks]));
    renderBatch(item.type);
  });
}

function renderBatchRows(item, body, summary, empty, wrap) {
  const query = item.search.trim().toLocaleLowerCase("it");
  const visible = item.type === "video" && query ? item.rows.filter((row) => row.name.toLocaleLowerCase("it").includes(query)) : item.rows;
  body.replaceChildren();
  visible.forEach((row) => {
    const index = item.rows.indexOf(row);
    const tr = document.createElement("tr");
    if (item.type === "video") tr.classList.toggle("excluded-from-pdf", !row.selected);
    if (item.type === "video") {
      const selectCell = makeElement("td", "select-column");
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.className = "video-row-check"; checkbox.checked = row.selected; checkbox.ariaLabel = `Seleziona ${row.name}`;
      checkbox.addEventListener("change", () => { row.selected = checkbox.checked; renderBatch(item.type); });
      selectCell.append(checkbox); tr.append(selectCell);
    }
    tr.append(makeElement("td", "number-column", String(index + 1)));
    const nameCell = makeElement("td", "file-name-cell");
    const input = document.createElement("input"); input.className = "file-name-input"; input.value = row.name; input.ariaLabel = `Nome ${item.type === "video" ? "clip" : "musica"} ${index + 1}`;
    input.addEventListener("input", () => { row.name = input.value; });
    input.addEventListener("blur", () => {
      row.name = input.value.trim() || (item.type === "video" ? "Clip senza nome" : "Musica senza nome");
      if (item.type === "video") item.rows.sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base", numeric: true }));
      renderBatch(item.type);
    });
    nameCell.append(input); tr.append(nameCell);
    if (item.type === "audio") tr.append(makeElement("td", "duration-column", row.duration));
    const action = makeElement("td", "action-column");
    const remove = makeElement("button", "remove-button", "×"); remove.type = "button"; remove.title = "Elimina questa riga";
    remove.addEventListener("click", () => { item.rows = item.rows.filter((entry) => entry.id !== row.id); renderBatch(item.type); });
    action.append(remove); tr.append(action); body.append(tr);
  });
  if (item.type === "video") {
    const selected = item.rows.filter((row) => row.selected).length;
    summary.textContent = `${item.rows.length} clip · ${selected} selezionate · Ordine A–Z`;
  } else summary.textContent = `${item.rows.length} ${item.rows.length === 1 ? "utilizzo musicale" : "utilizzi musicali"} · Timecode 25 fps`;
  empty.textContent = item.type === "video" && item.rows.length && !visible.length ? "Nessuna clip corrisponde alla ricerca." : item.type === "video" ? "Nessuna clip trovata." : "Nessuna musica trovata nelle tracce selezionate.";
  empty.classList.toggle("hidden", visible.length > 0); wrap.classList.toggle("hidden", !visible.length);
}

async function saveBatchItem(item, button) {
  if (!db) { toast("Database non configurato"); return false; }
  if (!item.rows.length) { toast("Non ci sono righe da salvare"); return false; }
  button.disabled = true;
  try {
    const payload = batchPayload(item);
    const result = item.savedId
      ? await db.from("dcp_audio_reports").update(payload).eq("id", item.savedId).select("id").single()
      : await db.from("dcp_audio_reports").insert(payload).select("id").single();
    if (result.error) throw result.error;
    const updating = Boolean(item.savedId); item.savedId = result.data.id; button.textContent = "Aggiorna DCP";
    toast(updating ? "DCP aggiornato nello storico" : "DCP salvato nello storico");
    return true;
  } catch (error) {
    toast(error.code === "42703" ? "Esegui la migrazione database della nuova versione" : `Salvataggio non riuscito: ${error.message}`);
    return false;
  } finally { button.disabled = false; }
}

async function pdfBatchItem(item, button, card) {
  if (item.type === "video" && !item.rows.some((row) => row.selected)) return toast("Seleziona almeno una clip per il PDF");
  if (!await saveBatchItem(item, button)) return;
  document.querySelectorAll(".batch-report-card.print-target").forEach((node) => node.classList.remove("print-target"));
  card.classList.add("print-target"); document.body.dataset.printMode = `${item.type}-batch`;
  setTimeout(() => window.print(), 180);
}

function buildBatchCard(item) {
  const card = makeElement("article", "batch-report-card panel"); card.dataset.batchId = item.id;
  const head = makeElement("div", "batch-file-summary");
  const badge = makeElement("div", "file-badge", "EDL");
  const meta = makeElement("div", "file-meta"); meta.append(makeElement("strong", "", item.file.name), makeElement("span", "", `${item.parsed.title || "Sequenza Avid"} · ${item.type === "video" ? item.parsed.videoTracks.length : item.parsed.audioTracks.length} tracce ${item.type}`));
  const dismiss = makeElement("button", "secondary-button", "Rimuovi"); dismiss.type = "button";
  dismiss.addEventListener("click", () => {
    if (item.type === "video") videoBatchItems = videoBatchItems.filter((entry) => entry.id !== item.id);
    else audioBatchItems = audioBatchItems.filter((entry) => entry.id !== item.id);
    if (!reportBatch(item.type).length) item.type === "video" ? showVideoLanding() : showAudioLanding(); else renderBatch(item.type);
  });
  head.append(badge, meta, dismiss); card.append(head);

  const controls = makeElement("section", "batch-track-controls");
  const titleRow = makeElement("div", "panel-title-row");
  const copy = makeElement("div"); copy.append(makeElement("p", "step-label", "TRACCE DA ANALIZZARE"), makeElement("h2", "", item.type === "video" ? "Tracce video" : "Tracce musicali"));
  const toggle = makeElement("button", "text-button"); toggle.type = "button"; titleRow.append(copy, toggle);
  const trackGrid = makeElement("div", "track-grid"); if (item.type === "video") trackGrid.classList.add("video-batch-tracks");
  batchTrackButtons(item, trackGrid, toggle);
  const generate = makeElement("button", "primary-button wide", item.generated ? "Rigenera elenco" : item.type === "video" ? "Elabora DCP Video" : "Elabora DCP Audio"); generate.type = "button";
  generate.addEventListener("click", () => {
    if (!item.selectedTracks.size) return toast(`Seleziona almeno una traccia ${item.type === "video" ? "video" : "musicale"}`);
    item.rows = item.type === "video" ? buildVideoReport(item.parsed, [...item.selectedTracks]) : buildAudioReport(item.parsed, [...item.selectedTracks]);
    item.generated = true; item.savedId = null; item.search = ""; renderBatch(item.type);
    requestAnimationFrame(() => batchContainer(item.type).querySelector(`[data-batch-id="${item.id}"] .batch-result`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  });
  controls.append(titleRow, trackGrid, generate); card.append(controls);

  if (item.generated) {
    const result = makeElement("section", "batch-result");
    const resultHead = makeElement("div", "results-header");
    const titleArea = makeElement("div", "result-title-area"); titleArea.append(makeElement("p", "step-label", item.type === "video" ? "RAPPORTO IMMAGINI" : "RAPPORTO MUSICALE"));
    const titleInput = document.createElement("input"); titleInput.className = "report-title-input"; titleInput.value = item.title; titleInput.ariaLabel = "Titolo DCP"; titleInput.addEventListener("input", () => { item.title = titleInput.value; });
    const summary = makeElement("p", "muted"); titleArea.append(titleInput, summary);
    const actions = makeElement("div", "result-actions batch-actions");
    const save = makeElement("button", "save-button", item.savedId ? "Aggiorna DCP" : "Salva DCP"); save.type = "button"; save.addEventListener("click", () => saveBatchItem(item, save));
    if (item.type === "audio") {
      const copyButton = makeElement("button", "secondary-button", "Copia elenco"); copyButton.type = "button"; copyButton.addEventListener("click", async () => { await navigator.clipboard.writeText(item.rows.map((row, i) => `${i + 1}. ${row.name} — ${row.duration}`).join("\n")); toast("Elenco copiato"); });
      const csv = makeElement("button", "secondary-button", "Esporta CSV"); csv.type = "button"; csv.addEventListener("click", () => downloadCsv(batchPayload(item).title, item.rows));
      actions.append(save, copyButton, csv);
    } else actions.append(save);
    const pdf = makeElement("button", "primary-button", "PDF"); pdf.type = "button"; pdf.addEventListener("click", () => pdfBatchItem(item, save, card)); actions.append(pdf);
    resultHead.append(titleArea, actions); result.append(resultHead);

    if (item.type === "video") {
      const filter = makeElement("div", "video-filter-bar batch-video-filter");
      const label = makeElement("label", "video-search"); label.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>';
      const search = document.createElement("input"); search.type = "search"; search.placeholder = "Cerca, ad esempio Getty"; search.value = item.search;
      search.addEventListener("input", () => { item.search = search.value; renderBatch(item.type); requestAnimationFrame(() => { const next = batchContainer(item.type).querySelector(`[data-batch-id="${item.id}"] input[type="search"]`); next?.focus(); next?.setSelectionRange(item.search.length, item.search.length); }); });
      const clear = makeElement("button", "", "×"); clear.type = "button"; clear.ariaLabel = "Cancella ricerca"; clear.addEventListener("click", () => { item.search = ""; renderBatch(item.type); });
      label.append(search, clear);
      const select = makeElement("button", "secondary-button", "Seleziona tutte"); select.type = "button"; select.addEventListener("click", () => { const q = item.search.trim().toLocaleLowerCase("it"); item.rows.filter((row) => !q || row.name.toLocaleLowerCase("it").includes(q)).forEach((row) => { row.selected = true; }); renderBatch(item.type); });
      const deselect = makeElement("button", "text-button", "Deseleziona visibili"); deselect.type = "button"; deselect.addEventListener("click", () => { const q = item.search.trim().toLocaleLowerCase("it"); item.rows.filter((row) => !q || row.name.toLocaleLowerCase("it").includes(q)).forEach((row) => { row.selected = false; }); renderBatch(item.type); });
      filter.append(label, select, deselect); result.append(filter);
    }
    const empty = makeElement("div", "empty-result");
    const wrap = makeElement("div", "table-wrap"); const table = document.createElement("table"); const thead = document.createElement("thead");
    thead.innerHTML = item.type === "video" ? '<tr><th class="select-column"><span class="sr-only">Seleziona</span></th><th class="number-column">N.</th><th>Nome clip</th><th class="action-column"><span class="sr-only">Azioni</span></th></tr>' : '<tr><th class="number-column">N.</th><th>File musicale</th><th class="duration-column">Durata</th><th class="action-column"><span class="sr-only">Azioni</span></th></tr>';
    const body = document.createElement("tbody"); if (item.type === "video") body.className = "batch-video-body";
    table.append(thead, body); wrap.append(table); result.append(empty, wrap); renderBatchRows(item, body, summary, empty, wrap); card.append(result);
  }
  return card;
}

function renderBatch(type) {
  const container = batchContainer(type); container.replaceChildren();
  reportBatch(type).forEach((item) => container.append(buildBatchCard(item)));
}

// DCP PUNTATE — rapporto unico immagini + musiche
function showEpisodeLanding() {
  $("#episodeEntryGrid").classList.remove("hidden");
  $("#episodeWorkspace").classList.add("hidden");
  $("#episodeBackButton").classList.add("hidden");
  showView("episode");
}

function newEpisodeRange() {
  return { id: `range-${++batchSequence}`, from: "", to: "" };
}

function episodeRanges(item, notify = true) {
  const ranges = [];
  for (const range of item.exclusions) {
    if (!range.from.trim() && !range.to.trim()) continue;
    const start = tcToFrames(range.from.trim(), item.parsed?.fps || 25);
    const end = tcToFrames(range.to.trim(), item.parsed?.fps || 25);
    if (start == null || end == null || end <= start) {
      if (notify) toast("Controlla gli intervalli DA–A: il timecode finale deve essere successivo");
      return null;
    }
    ranges.push({ start, end, from: range.from.trim(), to: range.to.trim() });
  }
  return ranges;
}

function episodeDurationInfo(item) {
  return timelineDuration(item.parsed, []);
}

async function loadEpisodeBatch(files) {
  const candidates = (Array.isArray(files) ? files : [files]).filter((file) => file && /\.(edl|txt)$/i.test(file.name));
  if (!candidates.length) return toast("Seleziona almeno un file EDL valido");
  const items = [];
  for (const file of candidates) {
    try {
      const parsed = parseEdl(await file.text(), 25);
      if (!parsed.intervals.length) continue;
      const remembered = readSavedTracks("dvs-audio-tracks").filter((track) => parsed.audioTracks.includes(track));
      items.push({
        id: `batch-episode-${++batchSequence}`, type: "episode", file, parsed,
        title: parsed.title || file.name.replace(/\.[^.]+$/, ""),
        selectedAudioTracks: new Set(remembered.length ? remembered : parsed.audioTracks),
        selectedVideoTracks: new Set(parsed.videoTracks), exclusions: [newEpisodeRange()],
        audioRows: [], videoRows: [], generated: false, savedId: null, search: ""
      });
    } catch { /* Un EDL non leggibile non blocca gli altri file. */ }
  }
  if (!items.length) return toast("Nessuno degli EDL selezionati contiene eventi leggibili");
  episodeBatchItems = items;
  $("#episodeEntryGrid").classList.add("hidden");
  $("#episodeWorkspace").classList.remove("hidden");
  $("#episodeBackButton").classList.remove("hidden");
  $("#episodeFileInput").value = "";
  renderEpisodeBatch();
  showView("episode");
  toast(`${items.length} ${items.length === 1 ? "puntata caricata" : "puntate caricate"}`);
}

function episodeTrackSelector(item, type) {
  const isVideo = type === "video";
  const tracks = isVideo ? item.parsed.videoTracks : item.parsed.audioTracks;
  const selected = isVideo ? item.selectedVideoTracks : item.selectedAudioTracks;
  const panel = makeElement("section", "episode-control-block");
  const heading = makeElement("div", "panel-title-row");
  const label = makeElement("div"); label.append(makeElement("p", "step-label", isVideo ? "DCP VIDEO" : "DCP AUDIO"), makeElement("h3", "", isVideo ? "Tracce video" : "Tracce musicali"));
  const toggle = makeElement("button", "text-button", tracks.length && tracks.every((track) => selected.has(track)) ? "Deseleziona tutte" : "Seleziona tutte"); toggle.type = "button";
  toggle.addEventListener("click", () => {
    const all = tracks.length && tracks.every((track) => selected.has(track));
    if (isVideo) item.selectedVideoTracks = new Set(all ? [] : tracks);
    else { item.selectedAudioTracks = new Set(all ? [] : tracks); localStorage.setItem("dvs-audio-tracks", JSON.stringify([...item.selectedAudioTracks])); }
    renderEpisodeBatch();
  });
  heading.append(label, toggle); panel.append(heading);
  const grid = makeElement("div", "track-grid episode-track-grid");
  tracks.forEach((track) => {
    const button = makeElement("button", `track-button${selected.has(track) ? " active" : ""}`, `${selected.has(track) ? "✓ " : ""}${track}`); button.type = "button";
    button.addEventListener("click", () => {
      selected.has(track) ? selected.delete(track) : selected.add(track);
      if (!isVideo) localStorage.setItem("dvs-audio-tracks", JSON.stringify([...selected]));
      renderEpisodeBatch();
    });
    grid.append(button);
  });
  panel.append(grid); return panel;
}

function episodeExclusions(item) {
  const panel = makeElement("section", "episode-control-block exclusion-block");
  const heading = makeElement("div", "panel-title-row");
  const label = makeElement("div"); label.append(makeElement("p", "step-label", "TIMELINE"), makeElement("h3", "", "Escludi intervalli"));
  const add = makeElement("button", "range-add-button", "+"); add.type = "button"; add.title = "Aggiungi intervallo";
  add.addEventListener("click", () => { item.exclusions.push(newEpisodeRange()); renderEpisodeBatch(); });
  heading.append(label, add); panel.append(heading);
  const list = makeElement("div", "exclusion-list");
  item.exclusions.forEach((range, index) => {
    const row = makeElement("div", "exclusion-row");
    const fromLabel = makeElement("label", ""); fromLabel.append(makeElement("span", "", "DA"));
    const from = document.createElement("input"); from.placeholder = "01:00:00:00"; from.inputMode = "numeric"; from.value = range.from; from.ariaLabel = `Timecode iniziale intervallo ${index + 1}`;
    from.addEventListener("input", () => { range.from = from.value; }); fromLabel.append(from);
    const toLabel = makeElement("label", ""); toLabel.append(makeElement("span", "", "A"));
    const to = document.createElement("input"); to.placeholder = "01:01:00:00"; to.inputMode = "numeric"; to.value = range.to; to.ariaLabel = `Timecode finale intervallo ${index + 1}`;
    to.addEventListener("input", () => { range.to = to.value; }); toLabel.append(to);
    const remove = makeElement("button", "remove-button", "×"); remove.type = "button"; remove.title = "Elimina intervallo";
    remove.addEventListener("click", () => { item.exclusions.splice(index, 1); if (!item.exclusions.length) item.exclusions.push(newEpisodeRange()); renderEpisodeBatch(); });
    row.append(fromLabel, toLabel, remove); list.append(row);
  });
  panel.append(list, makeElement("p", "muted exclusion-note", "Gli intervalli sono riferiti al Record TC della timeline e valgono per audio e video."));
  return panel;
}

function generateEpisode(item) {
  if (!item.selectedVideoTracks.size) return toast("Seleziona almeno una traccia video");
  if (!item.selectedAudioTracks.size) return toast("Seleziona almeno una traccia audio");
  const ranges = episodeRanges(item); if (!ranges) return;
  const filtered = excludeEdlRanges(item.parsed, ranges);
  item.videoRows = buildVideoReport(filtered, [...item.selectedVideoTracks]);
  item.audioRows = buildAudioReport(filtered, [...item.selectedAudioTracks]);
  item.generated = true; item.savedId = null; item.search = "";
  renderEpisodeBatch();
  requestAnimationFrame(() => $("#episodeBatchList").querySelector(`[data-batch-id="${item.id}"] .episode-results`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function episodePayload(item) {
  const ranges = episodeRanges(item, false) || [];
  const duration = timelineDuration(item.parsed, []);
  return {
    title: item.title.trim() || "DCP Puntata senza titolo", report_type: "episode",
    rows: {
      version: 1,
      audio: item.audioRows.map(({ name, duration, frames }) => ({ name, duration, frames })),
      video: item.videoRows.map(({ name, duration, frames, selected }) => ({ name, duration, frames, selected: Boolean(selected) })),
      audio_tracks: [...item.selectedAudioTracks], video_tracks: [...item.selectedVideoTracks],
      exclusions: ranges.map(({ from, to, start, end }) => ({ from, to, start, end })),
      duration: { value: duration.original, frames: duration.originalFrames },
      source: item.parsed ? { title: item.parsed.title, fps: item.parsed.fps, intervals: item.parsed.intervals, audioTracks: item.parsed.audioTracks, videoTracks: item.parsed.videoTracks, timelineStart: item.parsed.timelineStart, timelineEnd: item.parsed.timelineEnd } : null
    }
  };
}

async function saveEpisode(item, button) {
  if (!db) { toast("Database non configurato"); return false; }
  if (!item.generated || (!item.audioRows.length && !item.videoRows.length)) { toast("Genera prima il DCP Puntata"); return false; }
  button.disabled = true;
  try {
    const payload = episodePayload(item);
    const result = item.savedId
      ? await db.from("dcp_audio_reports").update(payload).eq("id", item.savedId).select("id").single()
      : await db.from("dcp_audio_reports").insert(payload).select("id").single();
    if (result.error) throw result.error;
    const updating = Boolean(item.savedId); item.savedId = result.data.id; button.textContent = "Aggiorna puntata";
    toast(updating ? "Puntata aggiornata nello storico" : "Puntata salvata nello storico"); return true;
  } catch (error) {
    toast(error.code === "23514" ? "Esegui il file SQL 004 per abilitare DCP Puntate" : `Salvataggio non riuscito: ${error.message}`); return false;
  } finally { button.disabled = false; }
}

async function deleteEpisode(item) {
  if (!item.savedId || !confirm(`Eliminare definitivamente “${item.title}” dallo Storico Puntate?`)) return;
  const { error } = await db.from("dcp_audio_reports").delete().eq("id", item.savedId);
  if (error) return toast(`Eliminazione non riuscita: ${error.message}`);
  episodeBatchItems = episodeBatchItems.filter((entry) => entry.id !== item.id);
  toast("Puntata eliminata dallo storico");
  if (!episodeBatchItems.length) showEpisodeLanding(); else renderEpisodeBatch();
}

async function pdfEpisode(item, button, card) {
  if (!await saveEpisode(item, button)) return;
  document.querySelectorAll(".episode-report-card.print-target").forEach((node) => node.classList.remove("print-target"));
  card.classList.add("print-target"); document.body.dataset.printMode = "episode-batch";
  setTimeout(() => window.print(), 180);
}

function episodeVideoRows(item, body, summary) {
  const query = item.search.trim().toLocaleLowerCase("it");
  const visible = query ? item.videoRows.filter((row) => row.name.toLocaleLowerCase("it").includes(query)) : item.videoRows;
  body.replaceChildren();
  visible.forEach((row) => {
    const index = item.videoRows.indexOf(row); const tr = document.createElement("tr"); tr.classList.toggle("excluded-from-pdf", !row.selected);
    const selectCell = makeElement("td", "select-column"); const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.className = "video-row-check"; checkbox.checked = row.selected;
    checkbox.addEventListener("change", () => { row.selected = checkbox.checked; renderEpisodeBatch(); }); selectCell.append(checkbox);
    tr.append(selectCell, makeElement("td", "number-column", String(index + 1)));
    const nameCell = makeElement("td", "file-name-cell"); const input = document.createElement("input"); input.className = "file-name-input"; input.value = row.name;
    input.addEventListener("input", () => { row.name = input.value; }); input.addEventListener("blur", () => { row.name = input.value.trim() || "Clip senza nome"; item.videoRows.sort((a,b) => a.name.localeCompare(b.name, "it", { sensitivity: "base", numeric: true })); renderEpisodeBatch(); }); nameCell.append(input); tr.append(nameCell);
    const action = makeElement("td", "action-column"); const remove = makeElement("button", "remove-button", "×"); remove.type = "button"; remove.addEventListener("click", () => { item.videoRows = item.videoRows.filter((entry) => entry.id !== row.id); renderEpisodeBatch(); }); action.append(remove); tr.append(action); body.append(tr);
  });
  summary.textContent = `${item.videoRows.length} clip · ${item.videoRows.filter((row) => row.selected).length} selezionate · Ordine A–Z`;
}

function episodeAudioRows(item, body, summary) {
  body.replaceChildren(); item.audioRows.forEach((row, index) => {
    const tr = document.createElement("tr"); tr.append(makeElement("td", "number-column", String(index + 1)));
    const nameCell = makeElement("td", "file-name-cell"); const input = document.createElement("input"); input.className = "file-name-input"; input.value = row.name;
    input.addEventListener("input", () => { row.name = input.value; }); input.addEventListener("blur", () => { row.name = input.value.trim() || "Musica senza nome"; }); nameCell.append(input); tr.append(nameCell, makeElement("td", "duration-column", row.duration));
    const action = makeElement("td", "action-column"); const remove = makeElement("button", "remove-button", "×"); remove.type = "button"; remove.addEventListener("click", () => { item.audioRows = item.audioRows.filter((entry) => entry.id !== row.id); renderEpisodeBatch(); }); action.append(remove); tr.append(action); body.append(tr);
  }); summary.textContent = `${item.audioRows.length} ${item.audioRows.length === 1 ? "utilizzo musicale" : "utilizzi musicali"} · Timecode ${item.parsed?.fps || 25} fps`;
}

function buildEpisodeCard(item) {
  const card = makeElement("article", "batch-report-card episode-report-card panel"); card.dataset.batchId = item.id;
  const head = makeElement("div", "batch-file-summary"); head.append(makeElement("div", "file-badge episode-file-badge", "EDL"));
  const meta = makeElement("div", "file-meta"); meta.append(makeElement("strong", "", item.file?.name || item.title), makeElement("span", "", `${item.parsed?.title || "Sequenza Avid"} · ${item.parsed?.videoTracks?.length || 0} video · ${item.parsed?.audioTracks?.length || 0} audio`)); head.append(meta);
  const dismiss = makeElement("button", "secondary-button", "Rimuovi"); dismiss.type = "button"; dismiss.addEventListener("click", () => { episodeBatchItems = episodeBatchItems.filter((entry) => entry.id !== item.id); if (!episodeBatchItems.length) showEpisodeLanding(); else renderEpisodeBatch(); }); head.append(dismiss); card.append(head);
  const duration = episodeDurationInfo(item);
  const durationStrip = makeElement("div", "episode-duration-strip");
  const generalDuration = makeElement("div", "episode-duration-item"); generalDuration.append(makeElement("small", "", "DURATA PUNTATA"), makeElement("strong", "", duration.original));
  durationStrip.append(generalDuration); card.append(durationStrip);
  if (item.parsed) {
    const controls = makeElement("section", "episode-controls-grid"); controls.append(episodeTrackSelector(item, "video"), episodeTrackSelector(item, "audio"), episodeExclusions(item)); card.append(controls);
    const generate = makeElement("button", "primary-button wide episode-generate", item.generated ? "Rigenera DCP Puntata" : "Genera DCP Puntata"); generate.type = "button"; generate.addEventListener("click", () => generateEpisode(item)); card.append(generate);
  }
  if (!item.generated) return card;
  const results = makeElement("section", "episode-results");
  const header = makeElement("div", "results-header episode-results-header"); const titleArea = makeElement("div", "result-title-area"); titleArea.append(makeElement("p", "step-label", "DCP PUNTATA"));
  const title = document.createElement("input"); title.className = "report-title-input"; title.value = item.title; title.addEventListener("input", () => { item.title = title.value; });
  const finalDuration = makeElement("strong", "episode-final-duration", `DURATA PUNTATA ${duration.original}`);
  titleArea.append(title, finalDuration, makeElement("p", "muted", "Documento unico con immagini e musiche"));
  const actions = makeElement("div", "result-actions episode-actions"); const save = makeElement("button", "save-button", item.savedId ? "Aggiorna puntata" : "Salva puntata"); save.type = "button"; save.addEventListener("click", () => saveEpisode(item, save)); actions.append(save);
  const pdf = makeElement("button", "primary-button", "PDF"); pdf.type = "button"; pdf.addEventListener("click", () => pdfEpisode(item, save, card)); actions.append(pdf);
  if (item.savedId) { const del = makeElement("button", "danger-button", "Elimina puntata"); del.type = "button"; del.addEventListener("click", () => deleteEpisode(item)); actions.append(del); }
  header.append(titleArea, actions); results.append(header);

  const videoSection = makeElement("section", "episode-result-section episode-video-section"); const videoHead = makeElement("div", "episode-section-heading"); const videoCopy = makeElement("div"); videoCopy.append(makeElement("p", "step-label", "SEZIONE VIDEO"), makeElement("h2", "", "Immagini")); const videoSummary = makeElement("p", "muted"); videoCopy.append(videoSummary); videoHead.append(videoCopy); videoSection.append(videoHead);
  const filter = makeElement("div", "video-filter-bar episode-video-filter"); const searchLabel = makeElement("label", "video-search"); searchLabel.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>';
  const search = document.createElement("input"); search.type = "search"; search.placeholder = "Cerca, ad esempio Getty"; search.value = item.search; search.addEventListener("input", () => { item.search = search.value; renderEpisodeBatch(); requestAnimationFrame(() => { const next = $("#episodeBatchList").querySelector(`[data-batch-id="${item.id}"] input[type="search"]`); next?.focus(); next?.setSelectionRange(item.search.length, item.search.length); }); });
  const clear = makeElement("button", "", "×"); clear.type = "button"; clear.addEventListener("click", () => { item.search = ""; renderEpisodeBatch(); }); searchLabel.append(search, clear);
  const select = makeElement("button", "secondary-button", "Seleziona tutte"); select.type = "button"; select.addEventListener("click", () => { const q = item.search.trim().toLocaleLowerCase("it"); item.videoRows.filter((row) => !q || row.name.toLocaleLowerCase("it").includes(q)).forEach((row) => { row.selected = true; }); renderEpisodeBatch(); });
  const deselect = makeElement("button", "text-button", "Deseleziona visibili"); deselect.type = "button"; deselect.addEventListener("click", () => { const q = item.search.trim().toLocaleLowerCase("it"); item.videoRows.filter((row) => !q || row.name.toLocaleLowerCase("it").includes(q)).forEach((row) => { row.selected = false; }); renderEpisodeBatch(); }); filter.append(searchLabel, select, deselect); videoSection.append(filter);
  const videoWrap = makeElement("div", "table-wrap"); const videoTable = document.createElement("table"); videoTable.innerHTML = '<thead><tr><th class="select-column"></th><th class="number-column">N.</th><th>Nome clip</th><th class="action-column"></th></tr></thead>'; const videoBody = document.createElement("tbody"); videoBody.className = "episode-video-body"; videoTable.append(videoBody); videoWrap.append(videoTable); videoSection.append(videoWrap); episodeVideoRows(item, videoBody, videoSummary);

  const audioSection = makeElement("section", "episode-result-section episode-audio-section"); const audioHead = makeElement("div", "episode-section-heading"); const audioCopy = makeElement("div"); audioCopy.append(makeElement("p", "step-label", "SEZIONE AUDIO"), makeElement("h2", "", "Musiche")); const audioSummary = makeElement("p", "muted"); audioCopy.append(audioSummary); audioHead.append(audioCopy); audioSection.append(audioHead);
  const audioWrap = makeElement("div", "table-wrap"); const audioTable = document.createElement("table"); audioTable.innerHTML = '<thead><tr><th class="number-column">N.</th><th>File musicale</th><th class="duration-column">Durata</th><th class="action-column"></th></tr></thead>'; const audioBody = document.createElement("tbody"); audioTable.append(audioBody); audioWrap.append(audioTable); audioSection.append(audioWrap); episodeAudioRows(item, audioBody, audioSummary);
  results.append(videoSection, audioSection); card.append(results); return card;
}

function renderEpisodeBatch() {
  const container = $("#episodeBatchList"); container.replaceChildren(); episodeBatchItems.forEach((item) => container.append(buildEpisodeCard(item)));
}

// DCP AUDIO
const audioEntryGrid = $("#audioEntryGrid");
const audioWorkspace = $("#workspace");
const audioResults = $("#resultsPanel");
const audioFileInput = $("#fileInput");

function showAudioLanding() {
  audioEntryGrid.classList.remove("hidden");
  audioWorkspace.classList.add("hidden");
  $("#audioBatchList").classList.add("hidden");
  $("#backButton").classList.add("hidden");
  showView("audio");
}

async function loadAudioFile(file) {
  if (!file || !/\.(edl|txt)$/i.test(file.name)) return toast("Seleziona un file EDL valido");
  const parsed = parseEdl(await file.text(), 25);
  if (!parsed.intervals.length) return toast("Nessun evento leggibile nell’EDL");
  parsedAudioEdl = parsed;
  currentAudioFile = file;
  const remembered = readSavedTracks("dvs-audio-tracks").filter((track) => parsed.audioTracks.includes(track));
  selectedAudioTracks = new Set(remembered.length ? remembered : parsed.audioTracks);
  $("#fileName").textContent = file.name;
  $("#fileDetails").textContent = `${parsed.title || "Sequenza Avid"} · ${parsed.audioTracks.length} tracce audio · ${parsed.videoTracks.length} tracce video rilevate`;
  audioEntryGrid.classList.add("hidden");
  audioWorkspace.classList.remove("hidden");
  $(".file-summary").classList.remove("hidden");
  $(".work-controls").classList.remove("hidden");
  audioResults.classList.add("hidden");
  $("#backButton").classList.remove("hidden");
  currentAudioSavedId = null;
  updateAudioSaveButtons();
  renderTrackButtons($("#trackGrid"), parsed.audioTracks, selectedAudioTracks, "dvs-audio-tracks", $("#toggleTracks"));
}

function updateAudioSaveButtons() {
  $("#saveButton").textContent = currentAudioSavedId ? "Aggiorna DCP" : "Salva DCP";
  $("#deleteDcpButton").classList.toggle("hidden", !currentAudioSavedId);
}

function renderAudioRows() {
  const body = $("#resultBody");
  body.replaceChildren();
  audioRows.forEach((row, index) => {
    const tr = document.createElement("tr");
    const number = document.createElement("td"); number.className = "number-column"; number.textContent = index + 1;
    const nameCell = document.createElement("td"); nameCell.className = "file-name-cell";
    const input = document.createElement("input"); input.className = "file-name-input"; input.value = row.name; input.ariaLabel = `Nome musica ${index + 1}`;
    input.addEventListener("input", () => { row.name = input.value; });
    input.addEventListener("blur", () => { row.name = input.value.trim() || "Musica senza nome"; input.value = row.name; });
    nameCell.append(input);
    const duration = document.createElement("td"); duration.className = "duration-column"; duration.textContent = row.duration;
    const action = document.createElement("td"); action.className = "action-column";
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-button"; remove.textContent = "×"; remove.title = "Elimina questa musica";
    remove.addEventListener("click", () => { audioRows = audioRows.filter((item) => item.id !== row.id); renderAudioRows(); });
    action.append(remove); tr.append(number, nameCell, duration, action); body.append(tr);
  });
  $("#resultSummary").textContent = `${audioRows.length} ${audioRows.length === 1 ? "utilizzo musicale" : "utilizzi musicali"} · Timecode 25 fps`;
  $("#emptyResult").classList.toggle("hidden", audioRows.length > 0);
  $("#tableWrap").classList.toggle("hidden", !audioRows.length);
}

function generateAudioReport() {
  if (!selectedAudioTracks.size) return toast("Seleziona almeno una traccia musicale");
  audioRows = buildAudioReport(parsedAudioEdl, [...selectedAudioTracks]);
  $("#resultTitle").value = parsedAudioEdl.title || currentAudioFile.name.replace(/\.[^.]+$/, "");
  currentAudioSavedId = null; updateAudioSaveButtons(); renderAudioRows();
  audioResults.classList.remove("hidden");
  audioResults.scrollIntoView({ behavior: "smooth", block: "start" });
}

function newAudioDcp() {
  parsedAudioEdl = null; currentAudioFile = null; selectedAudioTracks = new Set(); audioRows = []; currentAudioSavedId = null;
  audioFileInput.value = ""; updateAudioSaveButtons(); showAudioLanding();
}

function audioPayload() {
  return { title: $("#resultTitle").value.trim() || "DCP Audio senza titolo", report_type: "audio", rows: audioRows.map(({ name, duration, frames }) => ({ name, duration, frames })) };
}

// DCP VIDEO
const videoEntryGrid = $("#videoEntryGrid");
const videoWorkspace = $("#videoWorkspace");
const videoResults = $("#videoResultsPanel");
const videoFileInput = $("#videoFileInput");

function showVideoLanding() {
  videoEntryGrid.classList.remove("hidden");
  videoWorkspace.classList.add("hidden");
  $("#videoBatchList").classList.add("hidden");
  $("#videoBackButton").classList.add("hidden");
  showView("video");
}

async function loadVideoFile(file) {
  if (!file || !/\.(edl|txt)$/i.test(file.name)) return toast("Seleziona un file EDL valido");
  const parsed = parseEdl(await file.text(), 25);
  if (!parsed.intervals.length) return toast("Nessun evento leggibile nell’EDL");
  parsedVideoEdl = parsed; currentVideoFile = file;
  selectedVideoTracks = new Set(parsed.videoTracks);
  $("#videoFileName").textContent = file.name;
  $("#videoFileDetails").textContent = `${parsed.title || "Sequenza Avid"} · ${parsed.videoTracks.length} tracce video rilevate`;
  videoEntryGrid.classList.add("hidden"); videoWorkspace.classList.remove("hidden");
  $("#videoFileSummary").classList.remove("hidden"); $("#videoControls").classList.remove("hidden"); videoResults.classList.add("hidden");
  $("#videoBackButton").classList.remove("hidden"); currentVideoSavedId = null; updateVideoSaveButtons();
  renderTrackButtons($("#videoTrackGrid"), parsed.videoTracks, selectedVideoTracks, "dvs-video-tracks", $("#toggleVideoTracks"));
}

function updateVideoSaveButtons() {
  $("#saveVideoButton").textContent = currentVideoSavedId ? "Aggiorna DCP" : "Salva DCP";
  $("#deleteVideoDcpButton").classList.toggle("hidden", !currentVideoSavedId);
}

function filteredVideoRows() {
  const query = $("#videoSearchInput").value.trim().toLocaleLowerCase("it");
  return query ? videoRows.filter((row) => row.name.toLocaleLowerCase("it").includes(query)) : videoRows;
}

function renderVideoRows() {
  const visible = filteredVideoRows();
  const body = $("#videoResultBody"); body.replaceChildren();
  visible.forEach((row) => {
    const fullIndex = videoRows.indexOf(row);
    const tr = document.createElement("tr");
    tr.classList.toggle("excluded-from-pdf", !row.selected);
    const selectCell = document.createElement("td"); selectCell.className = "select-column";
    const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.className = "video-row-check"; checkbox.checked = row.selected; checkbox.ariaLabel = `Seleziona ${row.name}`;
    checkbox.addEventListener("change", () => { row.selected = checkbox.checked; renderVideoRows(); }); selectCell.append(checkbox);
    const number = document.createElement("td"); number.className = "number-column"; number.textContent = fullIndex + 1;
    const nameCell = document.createElement("td"); nameCell.className = "file-name-cell";
    const input = document.createElement("input"); input.className = "file-name-input"; input.value = row.name; input.ariaLabel = `Nome clip ${fullIndex + 1}`;
    input.addEventListener("input", () => { row.name = input.value; });
    input.addEventListener("blur", () => { row.name = input.value.trim() || "Clip senza nome"; videoRows.sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base", numeric: true })); renderVideoRows(); });
    nameCell.append(input);
    const action = document.createElement("td"); action.className = "action-column";
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-button"; remove.textContent = "×"; remove.title = "Elimina definitivamente questa riga";
    remove.addEventListener("click", () => { videoRows = videoRows.filter((item) => item.id !== row.id); renderVideoRows(); });
    action.append(remove); tr.append(selectCell, number, nameCell, action); body.append(tr);
  });
  const selectedCount = videoRows.filter((row) => row.selected).length;
  $("#videoResultSummary").textContent = `${videoRows.length} clip · ${selectedCount} selezionate · Ordine A–Z`;
  $("#emptyVideoResult").classList.toggle("hidden", visible.length > 0);
  $("#videoTableWrap").classList.toggle("hidden", !visible.length);
}

function generateVideoReport() {
  if (!selectedVideoTracks.size) return toast("Seleziona almeno una traccia video");
  videoRows = buildVideoReport(parsedVideoEdl, [...selectedVideoTracks]);
  $("#videoResultTitle").value = parsedVideoEdl.title || currentVideoFile.name.replace(/\.[^.]+$/, "");
  $("#videoSearchInput").value = ""; currentVideoSavedId = null; updateVideoSaveButtons(); renderVideoRows();
  videoResults.classList.remove("hidden"); videoResults.scrollIntoView({ behavior: "smooth", block: "start" });
}

function newVideoDcp() {
  parsedVideoEdl = null; currentVideoFile = null; selectedVideoTracks = new Set(); videoRows = []; currentVideoSavedId = null;
  videoFileInput.value = ""; $("#videoSearchInput").value = ""; updateVideoSaveButtons(); showVideoLanding();
}

function videoPayload() {
  return { title: $("#videoResultTitle").value.trim() || "DCP Video senza titolo", report_type: "video", rows: videoRows.map(({ name, duration, frames, selected }) => ({ name, duration, frames, selected })) };
}

async function saveReport(type) {
  if (!db) { toast("Database non configurato"); return false; }
  const isVideo = type === "video";
  const rows = isVideo ? videoRows : audioRows;
  if (!rows.length) { toast("Non ci sono righe da salvare"); return false; }
  const id = isVideo ? currentVideoSavedId : currentAudioSavedId;
  const button = isVideo ? $("#saveVideoButton") : $("#saveButton");
  button.disabled = true;
  try {
    const result = id
      ? await db.from("dcp_audio_reports").update(isVideo ? videoPayload() : audioPayload()).eq("id", id).select("id").single()
      : await db.from("dcp_audio_reports").insert(isVideo ? videoPayload() : audioPayload()).select("id").single();
    if (result.error) throw result.error;
    if (isVideo) { currentVideoSavedId = result.data.id; updateVideoSaveButtons(); }
    else { currentAudioSavedId = result.data.id; updateAudioSaveButtons(); }
    toast(id ? "DCP aggiornato nello storico" : "DCP salvato nello storico");
    return true;
  } catch (error) {
    toast(error.code === "42703" ? "Esegui la migrazione database della nuova versione" : `Salvataggio non riuscito: ${error.message}`);
    return false;
  } finally { button.disabled = false; }
}

async function saveAndPdf(type) {
  if (type === "video" && !videoRows.some((row) => row.selected)) return toast("Seleziona almeno una clip per il PDF");
  if (!await saveReport(type)) return;
  document.body.dataset.printMode = type;
  setTimeout(() => window.print(), 180);
}
window.addEventListener("afterprint", () => delete document.body.dataset.printMode);

async function deleteReport(type) {
  const isVideo = type === "video";
  const id = isVideo ? currentVideoSavedId : currentAudioSavedId;
  const title = isVideo ? $("#videoResultTitle").value.trim() : $("#resultTitle").value.trim();
  if (!id || !confirm(`Eliminare definitivamente “${title}” dallo storico?`)) return;
  const { error } = await db.from("dcp_audio_reports").delete().eq("id", id);
  if (error) return toast(`Eliminazione non riuscita: ${error.message}`);
  toast("DCP eliminato dallo storico");
  isVideo ? newVideoDcp() : newAudioDcp();
}

// STORICI DCP SEPARATI AUDIO / VIDEO
function formatDate(value) {
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function renderHistoryItems() {
  const list = $("#historyList");
  const visible = filterHistoryItems(historyItems, historyOrigin, $("#historySearchInput").value);
  list.replaceChildren();
  visible.forEach((item) => {
    const type = ["audio", "video", "episode"].includes(item.report_type) ? item.report_type : "audio";
    const button = document.createElement("button"); button.type = "button"; button.className = "history-row";
    button.innerHTML = `<span class="history-row-icon"></span><span><strong></strong><small></small></span><em></em><b>›</b>`;
    button.querySelector(".history-row-icon").textContent = type === "episode" ? "PUNTATA" : type === "video" ? "VIDEO" : "AUDIO";
    button.querySelector("strong").textContent = item.title;
    const rowCount = type === "episode" ? ((item.rows?.audio?.length || 0) + (item.rows?.video?.length || 0)) : (Array.isArray(item.rows) ? item.rows.length : 0);
    button.querySelector("small").textContent = `${rowCount} righe · Aggiornato ${formatDate(item.updated_at)}`;
    button.querySelector("em").textContent = formatDate(item.created_at);
    button.addEventListener("click", () => openSavedReport({ ...item, report_type: type })); list.append(button);
  });
  const typeLabel = historyOrigin === "episode" ? "Puntate" : historyOrigin === "video" ? "Video" : "Audio";
  $("#historyCount").textContent = `${visible.length} di ${historyItems.length} DCP ${typeLabel}`;
  const empty = $("#emptyHistory");
  empty.textContent = historyItems.length ? "Nessun DCP corrisponde alla ricerca." : `Non ci sono ancora DCP ${typeLabel} salvati.`;
  empty.classList.toggle("hidden", visible.length > 0);
}

async function loadHistory(origin = "audio") {
  historyOrigin = origin;
  const typeLabel = origin === "episode" ? "Puntate" : origin === "video" ? "Video" : "Audio";
  $("#historyNewDcp").textContent = origin === "episode" ? "+ Nuova puntata" : `+ Nuovo DCP ${typeLabel}`;
  $("#historyHeaderTitle").textContent = origin === "episode" ? "Storico Puntate" : `Storico DCP ${typeLabel}`;
  $("#historyPageTitle").textContent = origin === "episode" ? "Storico Puntate" : `Storico DCP ${typeLabel}`;
  $("#historySearchInput").value = "";
  historyItems = [];
  showView("history");
  const list = $("#historyList"); list.innerHTML = '<div class="history-loading">Caricamento storico…</div>';
  $("#historyCount").textContent = "";
  $("#emptyHistory").classList.add("hidden");
  if (!db) { list.innerHTML = '<div class="history-error">Database non configurato.</div>'; return; }
  const { data, error } = await db.from("dcp_audio_reports").select("id,title,report_type,rows,created_at,updated_at").eq("report_type", origin).order("updated_at", { ascending: false });
  if (error) { list.innerHTML = `<div class="history-error">Storico non disponibile: ${error.code === "42703" ? "esegui la migrazione database della nuova versione" : error.message}</div>`; return; }
  historyItems = filterHistoryItems(data, origin); renderHistoryItems();
}

function openSavedReport(item) {
  if (item.report_type === "episode") {
    const data = item.rows && !Array.isArray(item.rows) ? item.rows : {};
    const source = data.source || { title: item.title, fps: 25, intervals: [], audioTracks: data.audio_tracks || [], videoTracks: data.video_tracks || [] };
    const episode = {
      id: `batch-episode-${++batchSequence}`, type: "episode", file: null, parsed: source, title: item.title,
      selectedAudioTracks: new Set(data.audio_tracks || source.audioTracks || []), selectedVideoTracks: new Set(data.video_tracks || source.videoTracks || []),
      exclusions: (data.exclusions || []).map((range) => ({ id: `range-${++batchSequence}`, from: range.from || framesToTc(range.start || 0, source.fps || 25), to: range.to || framesToTc(range.end || 0, source.fps || 25) })),
      audioRows: cleanRows(data.audio, "audio"), videoRows: cleanRows(data.video, "video").sort((a,b) => a.name.localeCompare(b.name, "it", { sensitivity: "base", numeric: true })),
      generated: true, savedId: item.id, search: ""
    };
    if (!episode.exclusions.length) episode.exclusions.push(newEpisodeRange());
    episodeBatchItems = [episode]; $("#episodeEntryGrid").classList.add("hidden"); $("#episodeWorkspace").classList.remove("hidden"); $("#episodeBackButton").classList.remove("hidden"); renderEpisodeBatch(); showView("episode");
  } else if (item.report_type === "video") {
    videoRows = cleanRows(item.rows, "video").sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base", numeric: true }));
    $("#videoResultTitle").value = item.title; $("#videoSearchInput").value = ""; currentVideoSavedId = item.id;
    videoEntryGrid.classList.add("hidden"); videoWorkspace.classList.remove("hidden"); $("#videoBatchList").classList.add("hidden"); $("#videoFileSummary").classList.add("hidden"); $("#videoControls").classList.add("hidden");
    videoResults.classList.remove("hidden"); $("#videoBackButton").classList.remove("hidden"); updateVideoSaveButtons(); renderVideoRows(); showView("video");
  } else {
    audioRows = cleanRows(item.rows, "audio"); $("#resultTitle").value = item.title; currentAudioSavedId = item.id;
    audioEntryGrid.classList.add("hidden"); audioWorkspace.classList.remove("hidden"); $("#audioBatchList").classList.add("hidden"); $("#audioFileSummary").classList.add("hidden"); $(".work-controls").classList.add("hidden");
    audioResults.classList.remove("hidden"); $("#backButton").classList.remove("hidden"); updateAudioSaveButtons(); renderAudioRows(); showView("audio");
  }
}

// CALCOLATRICE TIMECODE
let calcFps = 25;
let calcDigits = "";
let calcAccumulator = null;
let calcOperator = null;
let calcShowingResult = false;
let calcHistory = [];
let calcPendingIndex = null;

function digitsToTc(digits) {
  const padded = String(digits || "").slice(-8).padStart(8, "0");
  return `${padded.slice(0,2)}:${padded.slice(2,4)}:${padded.slice(4,6)}:${padded.slice(6,8)}`;
}

function enteredFrames() {
  const tc = digitsToTc(calcDigits);
  const [hh, mm, ss, ff] = tc.split(":").map(Number);
  if (mm > 59 || ss > 59 || ff >= calcFps) { toast(`Timecode non valido a ${calcFps} fps`); return null; }
  return (((hh * 60 + mm) * 60 + ss) * calcFps) + ff;
}

function calcSymbol(operator) { return operator === "add" ? "+" : operator === "subtract" ? "−" : "DA–A"; }

function renderCalculator() {
  const displayFrames = calcDigits ? enteredFramesSilently() : calcAccumulator;
  $("#calculatorDisplay").textContent = calcDigits ? digitsToTc(calcDigits) : framesToTc(displayFrames || 0, calcFps);
  $("#calculatorExpression").textContent = calcOperator && calcAccumulator != null ? `${framesToTc(calcAccumulator, calcFps)} ${calcSymbol(calcOperator)}` : calcShowingResult ? "Risultato" : "Inserisci un timecode";
  const list = $("#calculatorHistoryList");
  if (!calcHistory.length) { list.innerHTML = '<p class="calculator-empty">Le operazioni compariranno qui.</p>'; return; }
  list.replaceChildren();
  [...calcHistory].reverse().forEach((entry) => {
    const row = document.createElement("div"); row.className = "calculator-history-row";
    row.innerHTML = `<span></span><strong></strong><small></small>`;
    row.classList.toggle("pending", Boolean(entry.pending));
    row.querySelector("span").textContent = entry.expression;
    row.querySelector("strong").textContent = entry.pending ? "In attesa…" : entry.result;
    row.querySelector("small").textContent = `${entry.fps} fps`; list.append(row);
  });
}

function enteredFramesSilently() {
  const [hh, mm, ss, ff] = digitsToTc(calcDigits).split(":").map(Number);
  return (((hh * 60 + mm) * 60 + ss) * calcFps) + ff;
}

function resetCalculation() {
  if (calcPendingIndex != null && calcHistory[calcPendingIndex]?.pending) calcHistory.splice(calcPendingIndex, 1);
  calcPendingIndex = null; calcDigits = ""; calcAccumulator = null; calcOperator = null; calcShowingResult = false; renderCalculator();
}

function enterDigit(digit) {
  if (calcShowingResult && !calcOperator) { calcAccumulator = null; calcShowingResult = false; }
  if (calcDigits.length < 8) calcDigits += digit;
  renderCalculator();
}

function chooseOperator(operator) {
  if (calcDigits) {
    const value = enteredFrames(); if (value == null) return;
    if (calcAccumulator == null) calcAccumulator = value;
    else if (calcOperator) calcAccumulator = applyCalculation(calcAccumulator, value, calcOperator, true);
  }
  if (calcAccumulator == null) return toast("Inserisci prima un timecode");
  calcDigits = ""; calcOperator = operator; calcShowingResult = false;
  const pending = { expression: `${framesToTc(calcAccumulator, calcFps)} ${calcSymbol(operator)}`, result: "", fps: calcFps, pending: true };
  if (calcPendingIndex != null && calcHistory[calcPendingIndex]?.pending) calcHistory[calcPendingIndex] = pending;
  else { calcHistory.push(pending); calcPendingIndex = calcHistory.length - 1; }
  renderCalculator();
}

function applyCalculation(first, second, operator, record = true) {
  if (operator === "range" && second < first) { toast("Il timecode finale deve essere successivo a quello iniziale"); return first; }
  const result = operator === "add" ? first + second : operator === "subtract" ? Math.max(0, first - second) : second - first;
  if (record) {
    const completed = { expression: `${framesToTc(first, calcFps)} ${calcSymbol(operator)} ${framesToTc(second, calcFps)}`, result: framesToTc(result, calcFps), fps: calcFps, pending: false };
    if (calcPendingIndex != null && calcHistory[calcPendingIndex]?.pending) calcHistory[calcPendingIndex] = completed;
    else calcHistory.push(completed);
    calcPendingIndex = null;
  }
  return result;
}

function calculateEquals() {
  if (!calcOperator || !calcDigits) return;
  const value = enteredFrames(); if (value == null) return;
  calcAccumulator = applyCalculation(calcAccumulator, value, calcOperator, true);
  calcDigits = ""; calcOperator = null; calcShowingResult = true; renderCalculator();
}

function calculatorAction(action) {
  if (action === "clear") return resetCalculation();
  if (action === "backspace") { calcDigits = calcDigits.slice(0, -1); return renderCalculator(); }
  if (action === "equals") return calculateEquals();
  chooseOperator(action === "range" ? "range" : action);
}

// LOUDNESS — elaborazione interamente locale
let loudnessFile = null;
let loudnessWav = null;
let loudnessAnalysis = null;
let loudnessNormalizedBlob = null;
let loudnessTask = null;

function formatFileSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function formatClock(seconds) {
  const total = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(total / 3600)).padStart(2, "0")}:${String(Math.floor(total % 3600 / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function drawWaveform(canvas, values, color = "#32d874") {
  const context = canvas.getContext("2d"); const width = canvas.width; const height = canvas.height;
  context.clearRect(0, 0, width, height); context.fillStyle = "rgba(255,255,255,.025)"; context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(255,255,255,.08)"; context.beginPath(); context.moveTo(0, height / 2); context.lineTo(width, height / 2); context.stroke();
  context.fillStyle = color;
  const barWidth = width / values.length;
  values.forEach((value, index) => { const amplitude = Math.max(1, Math.min(height * .46, value * height * .46)); context.fillRect(index * barWidth, height / 2 - amplitude, Math.max(1, barWidth - 1), amplitude * 2); });
}

function metricState(analysis) {
  const integratedOk = analysis.integrated >= -23.2 && analysis.integrated <= -22.8;
  const peakOk = analysis.truePeak <= loudnessLimits.TRUE_PEAK_LIMIT + 0.01;
  const lraOk = analysis.lra <= 20;
  return { integratedOk, peakOk, lraOk, compliant: integratedOk && peakOk && lraOk };
}

function updateMetric(id, value, unit, state) {
  const card = $(id); card.classList.remove("ok", "warning", "error"); card.classList.add(state);
  card.querySelector("strong").textContent = `${Number.isFinite(value) ? value.toFixed(1).replace("-0.0", "0.0") : "—"} ${unit}`;
}

function renderLoudnessResult(analysis, normalized = false) {
  const prefix = normalized ? "normalized" : "";
  const state = metricState(analysis);
  const integratedId = normalized ? "#normalizedIntegratedMetric" : "#integratedMetric";
  const peakId = normalized ? "#normalizedPeakMetric" : "#peakMetric";
  const lraId = normalized ? "#normalizedLraMetric" : "#lraMetric";
  updateMetric(integratedId, analysis.integrated, "LUFS", state.integratedOk ? "ok" : "error");
  updateMetric(peakId, analysis.truePeak, "dBTP", state.peakOk ? "ok" : "error");
  updateMetric(lraId, analysis.lra, "LU", state.lraOk ? (analysis.lra < 18 ? "ok" : "warning") : "error");
  const overall = normalized ? $("#normalizedOverall") : $("#loudnessOverall");
  overall.textContent = state.compliant ? (analysis.lra >= 18 ? "Conforme · LRA elevato" : "File conforme RAI") : "File non conforme";
  overall.className = state.compliant ? "result-ok" : "result-error";
  if (!normalized) {
    $("#loudnessResults").classList.remove("hidden");
    const measurable = Number.isFinite(analysis.integrated) && Number.isFinite(analysis.truePeak);
    $("#normalizeLoudnessButton").disabled = state.compliant || !measurable;
    $("#normalizeLoudnessButton").textContent = !measurable ? "Audio non misurabile" : state.compliant ? "Nessuna normalizzazione necessaria" : "Normalizza WAV";
  } else $("#normalizedResults").classList.remove("hidden");
  return state;
}

async function loadLoudnessFile(file) {
  if (!file || !/\.wav$/i.test(file.name)) return toast("Seleziona un file WAV non compresso");
  try {
    const wav = parseWav(await file.arrayBuffer());
    if (wav.channels > 8) throw new Error("Sono supportati al massimo 8 canali");
    loudnessFile = file; loudnessWav = wav; loudnessAnalysis = null; loudnessNormalizedBlob = null;
    $("#loudnessFileName").textContent = file.name;
    $("#loudnessFileDetails").textContent = `${wav.channels} ${wav.channels === 1 ? "canale" : "canali"} · ${wav.sampleRate.toLocaleString("it-IT")} Hz · ${wav.bitsPerSample} bit · ${formatClock(wav.duration)} · ${formatFileSize(file.size)}`;
    $("#loudnessDropZone").classList.add("hidden"); $("#loudnessWorkspace").classList.remove("hidden");
    ["#loudnessResults", "#normalizationPanel", "#verificationPanel", "#normalizedResults"].forEach((id) => $(id).classList.add("hidden"));
    $("#loudnessWavePercent").textContent = "0%"; $("#originalWaveformScan").style.width = "0%"; $("#loudnessStageTitle").textContent = "Pronto per l’analisi";
    drawWaveform($("#originalWaveform"), new Float32Array(720), "rgba(50,216,116,.65)");
  } catch (error) { toast(error.message); }
}

async function runLoudnessAnalysis() {
  if (!loudnessWav || loudnessTask) return;
  loudnessTask = { aborted: false }; $("#cancelLoudnessButton").classList.remove("hidden"); $("#analyzeLoudnessButton").disabled = true;
  $("#loudnessStageTitle").textContent = "Analisi in corso…";
  try {
    loudnessAnalysis = await analyzeWav(loudnessWav, (progress, waveform) => {
      const percentage = Math.round(progress * 100); $("#loudnessWavePercent").textContent = `${percentage}%`; $("#originalWaveformScan").style.width = `${percentage}%`; drawWaveform($("#originalWaveform"), waveform, "rgba(50,216,116,.78)");
    }, loudnessTask);
    $("#loudnessStageTitle").textContent = "Analisi completata"; renderLoudnessResult(loudnessAnalysis); toast("Analisi completata");
  } catch (error) { if (error.name !== "AbortError") toast(error.message); else toast("Analisi annullata"); }
  finally { loudnessTask = null; $("#cancelLoudnessButton").classList.add("hidden"); $("#analyzeLoudnessButton").disabled = false; }
}

async function runNormalization() {
  if (!loudnessAnalysis || loudnessTask) return;
  loudnessTask = { aborted: false }; $("#normalizeLoudnessButton").disabled = true; $("#normalizationPanel").classList.remove("hidden");
  $("#verificationPanel").classList.add("hidden"); $("#normalizedResults").classList.add("hidden");
  try {
    const normalized = await normalizeWav(loudnessWav, loudnessAnalysis, (progress) => {
      const percentage = Math.round(progress * 100); $("#normalizationPercent").textContent = `${percentage}%`; $("#normalizationBar").style.width = `${percentage}%`;
    }, loudnessTask);
    loudnessNormalizedBlob = normalized.blob;
    $("#normalizationStatus").textContent = `File creato · guadagno ${normalized.gainDb >= 0 ? "+" : ""}${normalized.gainDb.toFixed(2)} dB · verifica automatica in corso…`;
    $("#verificationPanel").classList.remove("hidden");
    const verifiedWav = parseWav(await normalized.blob.arrayBuffer());
    const verified = await analyzeWav(verifiedWav, (progress, waveform) => {
      const percentage = Math.round(progress * 100); $("#verificationPercent").textContent = `${percentage}%`; $("#normalizedWaveformScan").style.width = `${percentage}%`; drawWaveform($("#normalizedWaveform"), waveform, "rgba(50,216,116,.78)");
    }, loudnessTask);
    const finalState = renderLoudnessResult(verified, true);
    $("#normalizationStatus").textContent = finalState.compliant ? "Creazione e verifica completate. Il WAV è pronto per il download." : "File creato e verificato: controlla i parametri evidenziati in rosso prima della consegna.";
  } catch (error) { if (error.name !== "AbortError") toast(error.message); }
  finally { loudnessTask = null; $("#normalizeLoudnessButton").disabled = false; }
}

function downloadNormalizedWav() {
  if (!loudnessNormalizedBlob) return;
  const url = URL.createObjectURL(loudnessNormalizedBlob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${loudnessFile.name.replace(/\.wav$/i, "")}_NORMALIZZATO_RAI_24BIT_48KHZ.wav`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// SCHEDA TECNICA RAI
const serviceOptions = ["", "ANTEPRIMA", "PROGRAMMA", "OROLOGIO", "BARRE COLORE", "NERI COMMERCIALI", "NERO", "INTRO", "CODA FINALE", "CODA FINALE + FONDINI", "ALTRO"];

function updateTechnicalDuration(row) {
  const start = row.querySelector('[name^="serviceTc"]');
  const end = row.querySelector('[name^="serviceEnd"]');
  const duration = row.querySelector('[name^="serviceDuration"]');
  duration.value = technicalDuration(start.value, end.value);
}

function initTechnicalForm() {
  const services = $("#technicalServices");
  for (let index = 1; index <= 15; index += 1) {
    const row = document.createElement("div"); row.className = "service-editor-row";
    const options = serviceOptions.map((value) => `<option value="${value}">${value || "Seleziona…"}</option>`).join("");
    row.innerHTML = `<b>${index}</b><input name="serviceTc${index}" inputmode="numeric" placeholder="00:00:00:00"><input name="serviceEnd${index}" inputmode="numeric" placeholder="00:00:00:00"><input name="serviceDuration${index}" readonly placeholder="00:00:00"><select name="serviceName${index}">${options}</select>`;
    row.querySelectorAll('input:not([readonly])').forEach((input) => input.addEventListener("input", () => updateTechnicalDuration(row)));
    const select = row.querySelector("select");
    select.addEventListener("change", () => {
      if (select.value !== "ALTRO") return;
      const custom = prompt("Inserisci la dicitura del servizio:", "")?.trim();
      if (!custom) { select.value = ""; return; }
      select.add(new Option(custom.toUpperCase(), custom.toUpperCase()), 1); select.value = custom.toUpperCase();
    });
    services.append(row);
  }
  const channels = $("#technicalChannels");
  for (let index = 1; index <= 8; index += 1) channels.insertAdjacentHTML("beforeend", `<label><input type="checkbox" name="channels" value="CH${index}"> CH${index}</label>`);
}

function technicalFormData() {
  const result = {};
  [...$("#technicalForm").elements].forEach((field) => {
    if (!field.name || field.type === "button" || field.type === "submit") return;
    if (field.type === "checkbox") {
      if (!Array.isArray(result[field.name])) result[field.name] = [];
      if (field.checked) result[field.name].push(field.value);
    } else if (field.type === "radio") {
      if (field.checked) result[field.name] = field.value;
    } else result[field.name] = field.value;
  });
  return result;
}

function restoreTechnicalForm(saved = {}) {
  const form = $("#technicalForm"); form.reset();
  [...form.elements].forEach((field) => {
    if (!field.name || !(field.name in saved)) return;
    if (field.type === "checkbox") field.checked = Array.isArray(saved[field.name]) && saved[field.name].includes(field.value);
    else if (field.type === "radio") field.checked = saved[field.name] === field.value;
    else {
      if (field.tagName === "SELECT" && saved[field.name] && ![...field.options].some((option) => option.value === saved[field.name])) field.add(new Option(saved[field.name], saved[field.name]), 1);
      field.value = saved[field.name] ?? "";
    }
  });
  document.querySelectorAll("#technicalServices .service-editor-row").forEach((row) => {
    const end = row.querySelector('[name^="serviceEnd"]');
    if (end.value) updateTechnicalDuration(row);
  });
}

function updateTechnicalButtons() {
  $("#saveTechnicalButton").textContent = currentTechnicalSavedId ? "Aggiorna scheda" : "Salva scheda";
  $("#deleteTechnicalButton").classList.toggle("hidden", !currentTechnicalSavedId);
}

function hideTechnicalPanels() {
  $("#technicalWorkspace").classList.add("hidden");
  $("#technicalHistoryPanel").classList.add("hidden");
  $("#technicalPdfUploadPanel").classList.add("hidden");
  $("#technicalPdfDetail").classList.add("hidden");
}

function showTechnicalLanding() {
  $("#technicalEntryGrid").classList.remove("hidden");
  hideTechnicalPanels();
  $("#technicalBackButton").classList.add("hidden");
  showView("technical");
}

function newTechnicalSheet() {
  currentTechnicalSavedId = null; restoreTechnicalForm({}); updateTechnicalButtons();
  $("#technicalEntryGrid").classList.add("hidden");
  hideTechnicalPanels();
  $("#technicalWorkspace").classList.remove("hidden");
  $("#technicalBackButton").classList.remove("hidden");
  showView("technical");
}

function showTechnicalPdfUpload() {
  pendingTechnicalPdfFiles = [];
  $("#technicalEntryGrid").classList.add("hidden"); hideTechnicalPanels();
  $("#technicalPdfUploadPanel").classList.remove("hidden"); $("#technicalBackButton").classList.remove("hidden");
  renderTechnicalPdfSelection(); showView("technical");
}

function selectTechnicalPdfFiles(files) {
  const candidates = (Array.isArray(files) ? files : [files]).filter((file) => file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name)));
  if (!candidates.length) return toast("Seleziona almeno un file PDF");
  let rejected = 0;
  candidates.forEach((file) => {
    if (file.size > 50 * 1024 * 1024) { rejected += 1; return; }
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (pendingTechnicalPdfFiles.some((item) => item.key === key)) return;
    pendingTechnicalPdfFiles.push({ key, file, title: file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() });
  });
  if (rejected) toast(`${rejected} PDF ignorati perché superano 50 MB`);
  $("#technicalPdfFileInput").value = ""; renderTechnicalPdfSelection();
}

function renderTechnicalPdfSelection() {
  const hasFiles = pendingTechnicalPdfFiles.length > 0;
  $("#technicalPdfSelection").classList.toggle("hidden", !hasFiles);
  $("#technicalPdfDropZone").classList.toggle("compact", hasFiles);
  const list = $("#technicalPdfFileList"); list.replaceChildren();
  pendingTechnicalPdfFiles.forEach((item, index) => {
    const row = makeElement("div", "technical-pdf-file-row");
    const icon = makeElement("span", "technical-pdf-mini-icon", "PDF");
    const copy = makeElement("div", "technical-pdf-file-copy");
    const input = document.createElement("input"); input.value = item.title; input.ariaLabel = `Titolo PDF ${index + 1}`; input.addEventListener("input", () => { item.title = input.value; });
    copy.append(input, makeElement("small", "", `${item.file.name} · ${formatFileSize(item.file.size)}`));
    const remove = makeElement("button", "remove-button", "×"); remove.type = "button"; remove.title = "Rimuovi PDF"; remove.addEventListener("click", () => { pendingTechnicalPdfFiles.splice(index, 1); renderTechnicalPdfSelection(); });
    row.append(icon, copy, remove); list.append(row);
  });
}

async function saveTechnicalPdfs() {
  if (!db) return toast("Database non configurato");
  if (!pendingTechnicalPdfFiles.length) return toast("Seleziona almeno un PDF");
  if (pendingTechnicalPdfFiles.some((item) => !item.title.trim())) return toast("Inserisci un titolo per ogni PDF");
  const button = $("#saveTechnicalPdfs"); button.disabled = true;
  let completed = 0;
  try {
    for (const item of pendingTechnicalPdfFiles) {
      button.textContent = `Salvataggio ${completed + 1} di ${pendingTechnicalPdfFiles.length}…`;
      const today = new Date().toISOString().slice(0, 10);
      const id = crypto.randomUUID();
      const storagePath = `${today}/${id}.pdf`;
      const upload = await db.storage.from(TECHNICAL_PDF_BUCKET).upload(storagePath, item.file, { contentType: "application/pdf", upsert: false });
      if (upload.error) throw upload.error;
      const inserted = await db.from("technical_pdf_files").insert({ title: item.title.trim(), file_name: item.file.name, storage_path: storagePath, file_size: item.file.size, mime_type: "application/pdf" }).select("id").single();
      if (inserted.error) { await db.storage.from(TECHNICAL_PDF_BUCKET).remove([storagePath]); throw inserted.error; }
      completed += 1;
    }
    toast(`${completed} ${completed === 1 ? "PDF archiviato" : "PDF archiviati"} nello storico`);
    pendingTechnicalPdfFiles = []; await loadTechnicalHistory();
  } catch (error) {
    toast(error.statusCode === "404" || error.code === "42P01" ? "Esegui il file SQL 005 per abilitare l’archivio PDF" : `Caricamento non riuscito: ${error.message}`);
  } finally { button.disabled = false; button.textContent = "Salva nello storico"; }
}

async function saveTechnicalSheet() {
  const form = $("#technicalForm");
  if (!form.reportValidity()) return false;
  if (!db) { toast("Database non configurato"); return false; }
  const formData = technicalFormData();
  const payload = { title: String(formData.title || "Scheda tecnica senza titolo"), sheet_data: formData };
  const button = $("#saveTechnicalButton"); button.disabled = true;
  try {
    const result = currentTechnicalSavedId
      ? await db.from("technical_sheets").update(payload).eq("id", currentTechnicalSavedId).select("id").single()
      : await db.from("technical_sheets").insert(payload).select("id").single();
    if (result.error) throw result.error;
    currentTechnicalSavedId = result.data.id; updateTechnicalButtons();
    toast("Scheda tecnica salvata nello storico"); return true;
  } catch (error) {
    toast(error.code === "42P01" ? "Esegui la migrazione SQL della Scheda Tecnica" : `Salvataggio non riuscito: ${error.message}`); return false;
  } finally { button.disabled = false; }
}

function renderTechnicalHistory() {
  const query = $("#technicalHistorySearchInput").value.trim().toLocaleLowerCase("it");
  const visible = technicalHistoryItems.filter((item) => !query || item.title.toLocaleLowerCase("it").includes(query) || String(item.file_name || "").toLocaleLowerCase("it").includes(query));
  const list = $("#technicalHistoryList"); list.replaceChildren();
  visible.forEach((item) => {
    const button = document.createElement("button"); button.type = "button"; button.className = `history-row${item.kind === "pdf" ? " technical-pdf-history-row" : ""}`;
    button.innerHTML = '<span class="history-row-icon"></span><span><strong></strong><small></small></span><em></em><b>›</b>';
    button.querySelector(".history-row-icon").textContent = item.kind === "pdf" ? "PDF RAI" : "SCHEDA";
    button.querySelector("strong").textContent = item.title;
    button.querySelector("small").textContent = item.kind === "pdf" ? `${item.file_name} · ${formatFileSize(item.file_size || 0)}` : `Aggiornata ${formatDate(item.updated_at)}`;
    button.querySelector("em").textContent = formatDate(item.updated_at || item.created_at);
    button.addEventListener("click", () => item.kind === "pdf" ? openStoredTechnicalPdfDetail(item) : openGeneratedTechnicalSheet(item));
    list.append(button);
  });
  $("#technicalHistoryCount").textContent = `${visible.length} di ${technicalHistoryItems.length} schede`;
  const empty = $("#emptyTechnicalHistory"); empty.textContent = technicalHistoryItems.length ? "Nessuna scheda corrisponde alla ricerca." : "Non ci sono ancora schede tecniche salvate."; empty.classList.toggle("hidden", visible.length > 0);
}

function openGeneratedTechnicalSheet(item) {
  currentTechnicalSavedId = item.id; restoreTechnicalForm(item.sheet_data || {}); updateTechnicalButtons(); hideTechnicalPanels();
  $("#technicalWorkspace").classList.remove("hidden"); $("#technicalBackButton").classList.remove("hidden"); showView("technical");
}

function openStoredTechnicalPdfDetail(item) {
  currentStoredTechnicalPdf = item; hideTechnicalPanels();
  $("#technicalPdfDetailTitle").value = item.title;
  $("#technicalPdfDetailMeta").textContent = `${item.file_name} · ${formatFileSize(item.file_size || 0)} · Archiviato ${formatDate(item.created_at)}`;
  $("#technicalPdfDetail").classList.remove("hidden"); $("#technicalBackButton").classList.remove("hidden"); showView("technical");
}

async function loadTechnicalHistory() {
  $("#technicalEntryGrid").classList.add("hidden"); hideTechnicalPanels();
  $("#technicalHistoryPanel").classList.remove("hidden"); $("#technicalBackButton").classList.remove("hidden"); showView("technical");
  const list = $("#technicalHistoryList"); list.innerHTML = '<div class="history-loading">Caricamento storico…</div>';
  $("#technicalHistorySearchInput").value = ""; $("#technicalHistoryCount").textContent = ""; $("#emptyTechnicalHistory").classList.add("hidden");
  if (!db) { list.innerHTML = '<div class="history-error">Database non configurato.</div>'; return; }
  const [generated, uploaded] = await Promise.all([
    db.from("technical_sheets").select("id,title,sheet_data,created_at,updated_at"),
    db.from("technical_pdf_files").select("id,title,file_name,storage_path,file_size,mime_type,created_at,updated_at")
  ]);
  if (generated.error) { list.innerHTML = `<div class="history-error">Storico non disponibile: ${generated.error.code === "42P01" ? "esegui la migrazione SQL della Scheda Tecnica" : generated.error.message}</div>`; return; }
  if (uploaded.error && uploaded.error.code !== "42P01") { list.innerHTML = `<div class="history-error">Archivio PDF non disponibile: ${uploaded.error.message}</div>`; return; }
  technicalHistoryItems = [
    ...(generated.data || []).map((item) => ({ ...item, kind: "generated" })),
    ...(uploaded.data || []).map((item) => ({ ...item, kind: "pdf" }))
  ].sort((a, b) => {
    const byTitle = String(a.title || a.file_name || "").localeCompare(
      String(b.title || b.file_name || ""),
      "it",
      { sensitivity: "base", numeric: true }
    );
    if (byTitle) return byTitle;
    return String(a.file_name || "").localeCompare(String(b.file_name || ""), "it", { sensitivity: "base", numeric: true });
  });
  renderTechnicalHistory();
  if (uploaded.error?.code === "42P01") toast("Esegui il file SQL 005 per abilitare l’archivio PDF RAI");
}

async function technicalPdfBlob(item = currentStoredTechnicalPdf) {
  if (!item) return null;
  const result = await db.storage.from(TECHNICAL_PDF_BUCKET).download(item.storage_path);
  if (result.error) { toast(`PDF non disponibile: ${result.error.message}`); return null; }
  return result.data;
}

async function openStoredTechnicalPdfFile() {
  const preview = window.open("", "_blank");
  const blob = await technicalPdfBlob();
  if (!blob) { preview?.close(); return; }
  const url = URL.createObjectURL(blob);
  if (preview) preview.location.href = url; else toast("Il browser ha bloccato l’apertura del PDF");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function downloadStoredTechnicalPdfFile() {
  const blob = await technicalPdfBlob(); if (!blob) return;
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = currentStoredTechnicalPdf.file_name || `${currentStoredTechnicalPdf.title}.pdf`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function renameStoredTechnicalPdf() {
  if (!currentStoredTechnicalPdf) return;
  const title = $("#technicalPdfDetailTitle").value.trim(); if (!title) return toast("Inserisci un titolo");
  const result = await db.from("technical_pdf_files").update({ title }).eq("id", currentStoredTechnicalPdf.id).select("updated_at").single();
  if (result.error) return toast(`Aggiornamento non riuscito: ${result.error.message}`);
  currentStoredTechnicalPdf.title = title; currentStoredTechnicalPdf.updated_at = result.data.updated_at; toast("Titolo aggiornato");
}

async function deleteStoredTechnicalPdf() {
  if (!currentStoredTechnicalPdf || !confirm(`Eliminare definitivamente “${currentStoredTechnicalPdf.title}” e il relativo PDF?`)) return;
  const storage = await db.storage.from(TECHNICAL_PDF_BUCKET).remove([currentStoredTechnicalPdf.storage_path]);
  if (storage.error) return toast(`Eliminazione PDF non riuscita: ${storage.error.message}`);
  const record = await db.from("technical_pdf_files").delete().eq("id", currentStoredTechnicalPdf.id);
  if (record.error) return toast(`Eliminazione dati non riuscita: ${record.error.message}`);
  currentStoredTechnicalPdf = null; toast("PDF eliminato dallo storico"); await loadTechnicalHistory();
}

async function deleteTechnicalSheet() {
  if (!currentTechnicalSavedId || !confirm("Eliminare definitivamente questa scheda tecnica dallo storico?")) return;
  const { error } = await db.from("technical_sheets").delete().eq("id", currentTechnicalSavedId);
  if (error) return toast(`Eliminazione non riuscita: ${error.message}`);
  toast("Scheda tecnica eliminata dallo storico"); showTechnicalLanding();
}

function formatTechnicalDate(value) {
  if (!value) return ""; const [year, month, day] = value.split("-"); return `${day}/${month}/${year}`;
}

function fillChecklist(container, options, selected) {
  container.replaceChildren(); options.forEach((option) => { const line = document.createElement("span"); line.textContent = `${selected.includes(option) ? "☒" : "☐"} ${option}`; container.append(line); });
}

function buildTechnicalPrint() {
  const form = $("#technicalForm"); const data = new FormData(form);
  document.querySelectorAll("#technicalPrintSheet [data-print]").forEach((element) => {
    const name = element.dataset.print; const raw = String(data.get(name) || ""); element.textContent = /Date|editStart|editEnd/.test(name) ? formatTechnicalDate(raw) : raw;
  });
  const services = $("#technicalPrintServices"); services.replaceChildren();
  let printedIndex = 0;
  for (let index = 1; index <= 15; index += 1) {
    const start = data.get(`serviceTc${index}`) || ""; const duration = data.get(`serviceDuration${index}`) || ""; const name = data.get(`serviceName${index}`) || "";
    if (!start && !duration && !name) continue;
    printedIndex += 1;
    const row = document.createElement("div"); row.innerHTML = `<b>${printedIndex}</b><span></span><span></span><span></span>`;
    row.children[1].textContent = start; row.children[2].textContent = duration; row.children[3].textContent = name; services.append(row);
  }
  $("#technicalPrintSheet").classList.toggle("dense-services", printedIndex > 9);
  fillChecklist($("#printDelivery"), ["BETA SP", "IMX", "XDCAM", "ALTRO"], data.getAll("delivery"));
  fillChecklist($("#printAudioType"), ["MONO", "STEREO", "DOLBY", "ALTRO"], data.getAll("audioType"));
  fillChecklist($("#printChannels"), Array.from({ length: 8 }, (_, i) => `CH${i + 1}`), data.getAll("channels"));
}

async function printTechnicalSheet(event) {
  event.preventDefault();
  if (!$("#technicalForm").reportValidity()) return;
  if (!await saveTechnicalSheet()) return;
  buildTechnicalPrint(); document.body.dataset.printMode = "technical"; window.print();
}

// NAVIGAZIONE E AZIONI
$("#openAudio").addEventListener("click", showAudioLanding);
$("#openAudioNav").addEventListener("click", showAudioLanding);
$("#iphoneAudioNav").addEventListener("click", showAudioLanding);
$("#openVideo").addEventListener("click", showVideoLanding);
$("#openVideoNav").addEventListener("click", showVideoLanding);
$("#iphoneVideoNav").addEventListener("click", showVideoLanding);
$("#openEpisode").addEventListener("click", showEpisodeLanding);
$("#openEpisodeNav").addEventListener("click", showEpisodeLanding);
$("#openCalculator").addEventListener("click", () => showView("calculator"));
$("#openCalculatorNav").addEventListener("click", () => showView("calculator"));
$("#iphoneCalculatorNav").addEventListener("click", () => showView("calculator"));
$("#openLoudness").addEventListener("click", () => showView("loudness"));
$("#openLoudnessNav").addEventListener("click", () => showView("loudness"));
$("#openTechnical").addEventListener("click", showTechnicalLanding);
$("#openTechnicalNav").addEventListener("click", showTechnicalLanding);
$("#openHomeNav").addEventListener("click", () => showView("home"));
$("#iphoneHomeNav").addEventListener("click", () => showView("home"));
$("#homeButton").addEventListener("click", () => showView("home"));
$("#iphoneBrand").addEventListener("click", () => showView("home"));
$("#openInfoNav").addEventListener("click", () => showView("info"));
$("#infoBackButton").addEventListener("click", () => showView("home"));

$("#backButton").addEventListener("click", showAudioLanding);
$("#browseButton").addEventListener("click", () => audioFileInput.click());
$("#changeFile").addEventListener("click", () => audioFileInput.click());
setupDropZone($("#dropZone"), audioFileInput, (files) => loadEdlBatch(files, "audio"));
$("#toggleTracks").addEventListener("click", () => { const tracks = parsedAudioEdl.audioTracks; const all = tracks.every((track) => selectedAudioTracks.has(track)); selectedAudioTracks = new Set(all ? [] : tracks); localStorage.setItem("dvs-audio-tracks", JSON.stringify([...selectedAudioTracks])); renderTrackButtons($("#trackGrid"), tracks, selectedAudioTracks, "dvs-audio-tracks", $("#toggleTracks")); });
$("#generateButton").addEventListener("click", generateAudioReport);
$("#newDcpButton").addEventListener("click", newAudioDcp);
$("#saveButton").addEventListener("click", () => saveReport("audio"));
$("#printButton").addEventListener("click", () => saveAndPdf("audio"));
$("#deleteDcpButton").addEventListener("click", () => deleteReport("audio"));
$("#copyButton").addEventListener("click", async () => { const text = audioRows.map((row, i) => `${i + 1}. ${row.name} — ${row.duration}`).join("\n"); await navigator.clipboard.writeText(text); toast("Elenco copiato"); });
$("#csvButton").addEventListener("click", () => downloadCsv(audioPayload().title, audioRows));

$("#videoBackButton").addEventListener("click", showVideoLanding);
$("#videoBrowseButton").addEventListener("click", () => videoFileInput.click());
$("#videoChangeFile").addEventListener("click", () => videoFileInput.click());
setupDropZone($("#videoDropZone"), videoFileInput, (files) => loadEdlBatch(files, "video"));
$("#toggleVideoTracks").addEventListener("click", () => { const tracks = parsedVideoEdl.videoTracks; const all = tracks.every((track) => selectedVideoTracks.has(track)); selectedVideoTracks = new Set(all ? [] : tracks); localStorage.setItem("dvs-video-tracks", JSON.stringify([...selectedVideoTracks])); renderTrackButtons($("#videoTrackGrid"), tracks, selectedVideoTracks, "dvs-video-tracks", $("#toggleVideoTracks")); });
$("#generateVideoButton").addEventListener("click", generateVideoReport);
$("#newVideoDcpButton").addEventListener("click", newVideoDcp);
$("#saveVideoButton").addEventListener("click", () => saveReport("video"));
$("#videoPdfButton").addEventListener("click", () => saveAndPdf("video"));
$("#deleteVideoDcpButton").addEventListener("click", () => deleteReport("video"));
$("#videoSearchInput").addEventListener("input", renderVideoRows);
$("#clearVideoSearch").addEventListener("click", () => { $("#videoSearchInput").value = ""; renderVideoRows(); $("#videoSearchInput").focus(); });
$("#selectVisibleVideo").addEventListener("click", () => { filteredVideoRows().forEach((row) => { row.selected = true; }); renderVideoRows(); });
$("#deselectVisibleVideo").addEventListener("click", () => { filteredVideoRows().forEach((row) => { row.selected = false; }); renderVideoRows(); });

$("#episodeBackButton").addEventListener("click", showEpisodeLanding);
$("#episodeBrowseButton").addEventListener("click", () => $("#episodeFileInput").click());
setupDropZone($("#episodeDropZone"), $("#episodeFileInput"), loadEpisodeBatch);

$("#openHistoryButton").addEventListener("click", () => loadHistory("audio"));
$("#openVideoHistoryButton").addEventListener("click", () => loadHistory("video"));
$("#openEpisodeHistoryButton").addEventListener("click", () => loadHistory("episode"));
$("#historyBackButton").addEventListener("click", () => historyOrigin === "episode" ? showEpisodeLanding() : historyOrigin === "video" ? showVideoLanding() : showAudioLanding());
$("#historyBackInline").addEventListener("click", () => historyOrigin === "episode" ? showEpisodeLanding() : historyOrigin === "video" ? showVideoLanding() : showAudioLanding());
$("#historyNewDcp").addEventListener("click", () => historyOrigin === "episode" ? showEpisodeLanding() : historyOrigin === "video" ? newVideoDcp() : newAudioDcp());
$("#historySearchInput").addEventListener("input", renderHistoryItems);
$("#clearHistorySearch").addEventListener("click", () => { $("#historySearchInput").value = ""; renderHistoryItems(); $("#historySearchInput").focus(); });

$("#fpsSelector").addEventListener("click", (event) => { const button = event.target.closest("button[data-fps]"); if (!button) return; calcFps = Number(button.dataset.fps); $("#fpsSelector").querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button)); $("#fpsLabel").textContent = `${calcFps} fps`; resetCalculation(); });
$("#calculatorKeypad").addEventListener("click", (event) => { const button = event.target.closest("button"); if (!button) return; if (button.dataset.digit != null) enterDigit(button.dataset.digit); else if (button.dataset.action) calculatorAction(button.dataset.action); });
$("#clearCalculatorHistory").addEventListener("click", () => { calcHistory = []; calcPendingIndex = null; renderCalculator(); });
window.addEventListener("keydown", (event) => { if (!views.calculator.classList.contains("active")) return; if (/^\d$/.test(event.key)) enterDigit(event.key); else if (event.key === "Backspace") calculatorAction("backspace"); else if (event.key === "+") calculatorAction("add"); else if (event.key === "-") calculatorAction("subtract"); else if (event.key === "Enter" || event.key === "=") calculatorAction("equals"); else if (event.key === "Escape") calculatorAction("clear"); });

const loudnessFileInput = $("#loudnessFileInput");
$("#loudnessBrowseButton").addEventListener("click", () => loudnessFileInput.click());
$("#loudnessChangeFile").addEventListener("click", () => loudnessFileInput.click());
setupDropZone($("#loudnessDropZone"), loudnessFileInput, loadLoudnessFile);
$("#analyzeLoudnessButton").addEventListener("click", runLoudnessAnalysis);
$("#cancelLoudnessButton").addEventListener("click", () => { if (loudnessTask) loudnessTask.aborted = true; });
$("#normalizeLoudnessButton").addEventListener("click", runNormalization);
$("#downloadNormalizedButton").addEventListener("click", downloadNormalizedWav);

initTechnicalForm();
$("#technicalForm").addEventListener("submit", printTechnicalSheet);
$("#clearTechnicalForm").addEventListener("click", () => { if (confirm("Vuoi cancellare tutti i dati inseriti nella scheda?")) restoreTechnicalForm({}); });
$("#technicalBackButton").addEventListener("click", () => $("#technicalPdfDetail").classList.contains("hidden") ? showTechnicalLanding() : loadTechnicalHistory());
$("#newTechnicalButton").addEventListener("click", newTechnicalSheet);
$("#uploadTechnicalPdfButton").addEventListener("click", showTechnicalPdfUpload);
$("#openTechnicalHistoryButton").addEventListener("click", loadTechnicalHistory);
$("#technicalHistoryBackInline").addEventListener("click", showTechnicalLanding);
$("#technicalHistoryUpload").addEventListener("click", showTechnicalPdfUpload);
$("#technicalHistoryNew").addEventListener("click", newTechnicalSheet);
$("#newTechnicalFromFormButton").addEventListener("click", newTechnicalSheet);
$("#saveTechnicalButton").addEventListener("click", saveTechnicalSheet);
$("#deleteTechnicalButton").addEventListener("click", deleteTechnicalSheet);
$("#technicalPdfBrowseButton").addEventListener("click", () => $("#technicalPdfFileInput").click());
$("#technicalPdfAddMore").addEventListener("click", () => $("#technicalPdfFileInput").click());
setupDropZone($("#technicalPdfDropZone"), $("#technicalPdfFileInput"), selectTechnicalPdfFiles);
$("#clearTechnicalPdfSelection").addEventListener("click", () => { pendingTechnicalPdfFiles = []; renderTechnicalPdfSelection(); });
$("#saveTechnicalPdfs").addEventListener("click", saveTechnicalPdfs);
$("#technicalHistorySearchInput").addEventListener("input", renderTechnicalHistory);
$("#clearTechnicalHistorySearch").addEventListener("click", () => { $("#technicalHistorySearchInput").value = ""; renderTechnicalHistory(); $("#technicalHistorySearchInput").focus(); });
$("#openStoredTechnicalPdf").addEventListener("click", openStoredTechnicalPdfFile);
$("#downloadStoredTechnicalPdf").addEventListener("click", downloadStoredTechnicalPdfFile);
$("#renameStoredTechnicalPdf").addEventListener("click", renameStoredTechnicalPdf);
$("#deleteStoredTechnicalPdf").addEventListener("click", deleteStoredTechnicalPdf);
window.addEventListener("afterprint", () => {
  delete document.body.dataset.printMode;
  document.querySelectorAll(".batch-report-card.print-target").forEach((node) => node.classList.remove("print-target"));
  document.querySelectorAll(".episode-report-card.print-target").forEach((node) => node.classList.remove("print-target"));
});

function downloadCsv(title, rows) {
  const selected = rows.filter((row) => row.selected !== false);
  const data = [["N.", "Nome", "Durata"], ...selected.map((row, index) => [index + 1, row.name, row.duration])];
  const csv = data.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${title}.csv`.replace(/[\\/:*?"<>|]/g, "-"); anchor.click(); URL.revokeObjectURL(url);
}

renderCalculator();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
