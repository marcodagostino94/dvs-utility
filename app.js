import { buildAudioReport, parseEdl } from "./parser.js";

const $ = (selector) => document.querySelector(selector);
const homeView = $("#homeView");
const audioView = $("#audioView");
const historyView = $("#historyView");
const infoView = $("#infoView");
const audioEntryGrid = $("#audioEntryGrid");
const fileInput = $("#fileInput");
const dropZone = $("#dropZone");
const workspace = $("#workspace");
const resultsPanel = $("#resultsPanel");
const trackGrid = $("#trackGrid");
const resultBody = $("#resultBody");
const tableWrap = $("#tableWrap");
const emptyResult = $("#emptyResult");
const mobileNav = $(".iphone-bottom-nav");
const hasDatabase = Boolean(window.DVS_SUPABASE?.url && window.DVS_SUPABASE?.publishableKey && window.supabase?.createClient);
const db = hasDatabase ? window.supabase.createClient(window.DVS_SUPABASE.url, window.DVS_SUPABASE.publishableKey) : null;

let parsedEdl = null;
let currentFile = null;
let selectedTracks = new Set();
let reportRows = [];
let currentSavedId = null;

function showView(view) {
  const isHome = view === "home";
  const isAudio = view === "audio";
  homeView.classList.toggle("active", isHome);
  audioView.classList.toggle("active", isAudio);
  historyView.classList.toggle("active", view === "history");
  infoView.classList.toggle("active", view === "info");
  $("#openHomeNav").classList.toggle("active", isHome);
  $("#openAudioNav").classList.toggle("active", isAudio || view === "history");
  $("#openInfoNav").classList.toggle("active", view === "info");
  $("#iphoneHomeNav").classList.toggle("active", isHome);
  $("#iphoneAudioNav").classList.toggle("active", isAudio || view === "history");
  mobileNav.classList.toggle("audio-active", isAudio || view === "history");
  $("#iphoneSectionTitle").textContent = view === "history" ? "STORICO DCP" : view === "info" ? "INFORMAZIONI" : isAudio ? "DCP AUDIO" : "UTILITY";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.remove("show"), 2300);
}

function savedTracks() {
  try { return JSON.parse(localStorage.getItem("dvs-audio-tracks") || "[]"); }
  catch { return []; }
}

function cleanStoredRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => ({
    id: row.id || `saved-${index}-${Date.now()}`,
    name: String(row.name || "Musica senza nome"),
    duration: String(row.duration || "00:00:00:00"),
    frames: Number(row.frames || 0)
  }));
}

function reportPayload() {
  return {
    title: $("#resultTitle").value.trim() || "DCP Audio senza titolo",
    rows: reportRows.map(({ name, duration, frames }) => ({ name, duration, frames }))
  };
}

function setSavedState(id = null) {
  currentSavedId = id;
  $("#saveButton").textContent = id ? "Aggiorna DCP" : "Salva DCP";
  $("#deleteDcpButton").classList.toggle("hidden", !id);
}

function renderTracks() {
  trackGrid.replaceChildren();
  for (const track of parsedEdl.audioTracks) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `track-button${selectedTracks.has(track) ? " active" : ""}`;
    button.textContent = track;
    button.setAttribute("aria-pressed", String(selectedTracks.has(track)));
    button.addEventListener("click", () => {
      selectedTracks.has(track) ? selectedTracks.delete(track) : selectedTracks.add(track);
      localStorage.setItem("dvs-audio-tracks", JSON.stringify([...selectedTracks]));
      renderTracks();
    });
    trackGrid.append(button);
  }
  const allSelected = parsedEdl.audioTracks.length > 0 && parsedEdl.audioTracks.every((track) => selectedTracks.has(track));
  $("#toggleTracks").textContent = allSelected ? "Deseleziona tutte" : "Seleziona tutte";
}

async function loadFile(file) {
  if (!file || !/\.(edl|txt)$/i.test(file.name)) return toast("Seleziona un file EDL valido");
  const parsed = parseEdl(await file.text(), 25);
  if (!parsed.intervals.length) return toast("Nessun evento leggibile nell’EDL");
  currentFile = file;
  parsedEdl = parsed;
  const previous = savedTracks().filter((track) => parsed.audioTracks.includes(track));
  selectedTracks = new Set(previous.length ? previous : parsed.audioTracks);
  $("#fileName").textContent = file.name;
  $("#fileDetails").textContent = `${parsed.title || "Sequenza Avid"} · ${parsed.audioTracks.length} tracce audio · ${parsed.videoTracks.length} tracce video rilevate`;
  audioEntryGrid.classList.add("hidden");
  workspace.classList.remove("hidden");
  $(".file-summary").classList.remove("hidden");
  $(".two-column").classList.remove("hidden");
  resultsPanel.classList.add("hidden");
  setSavedState();
  renderTracks();
}

function renderResults() {
  resultBody.replaceChildren();
  reportRows.forEach((row, index) => {
    const tr = document.createElement("tr");
    const order = document.createElement("td");
    order.className = "number-column";
    order.textContent = String(index + 1);
    const nameCell = document.createElement("td");
    nameCell.className = "file-name-cell";
    const input = document.createElement("input");
    input.className = "file-name-input";
    input.value = row.name;
    input.setAttribute("aria-label", `Nome musica ${index + 1}`);
    input.addEventListener("input", () => { row.name = input.value; });
    input.addEventListener("blur", () => { row.name = input.value.trim() || "Musica senza nome"; input.value = row.name; });
    nameCell.append(input);
    const duration = document.createElement("td");
    duration.className = "duration-column";
    duration.textContent = row.duration;
    const action = document.createElement("td");
    action.className = "action-column";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-button";
    remove.textContent = "×";
    remove.title = "Elimina questa musica";
    remove.addEventListener("click", () => { reportRows = reportRows.filter((item) => item.id !== row.id); renderResults(); });
    action.append(remove);
    tr.append(order, nameCell, duration, action);
    resultBody.append(tr);
  });
  $("#resultSummary").textContent = `${reportRows.length} ${reportRows.length === 1 ? "utilizzo musicale" : "utilizzi musicali"} · Timecode 25 fps`;
  emptyResult.classList.toggle("hidden", reportRows.length > 0);
  tableWrap.classList.toggle("hidden", reportRows.length === 0);
}

function generateReport() {
  if (!selectedTracks.size) return toast("Seleziona almeno una traccia musicale");
  reportRows = buildAudioReport(parsedEdl, [...selectedTracks]);
  $("#resultTitle").value = parsedEdl.title || currentFile.name.replace(/\.[^.]+$/, "");
  setSavedState();
  renderResults();
  resultsPanel.classList.remove("hidden");
  resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function newDcp() {
  parsedEdl = null;
  currentFile = null;
  reportRows = [];
  selectedTracks = new Set();
  fileInput.value = "";
  dropZone.classList.remove("hidden");
  audioEntryGrid.classList.remove("hidden");
  workspace.classList.add("hidden");
  resultsPanel.classList.add("hidden");
  setSavedState();
  showView("audio");
}

function currentText() {
  return `${$("#resultTitle").value.trim()}\n\n${reportRows.map((row, index) => `${index + 1}. ${row.name} — ${row.duration}`).join("\n")}`;
}

function downloadCsv() {
  const rows = [["N.", "File musicale", "Durata (25 fps)"], ...reportRows.map((row, index) => [index + 1, row.name, row.duration])];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${$("#resultTitle").value.trim() || "DCP-Audio"}.csv`.replace(/[\\/:*?"<>|]/g, "-");
  anchor.click();
  URL.revokeObjectURL(url);
}

async function saveDcp() {
  if (!db) { toast("Database non configurato"); return false; }
  if (!reportRows.length) { toast("Non ci sono righe da salvare"); return false; }
  const payload = reportPayload();
  $("#saveButton").disabled = true;
  try {
    const wasExisting = Boolean(currentSavedId);
    const result = wasExisting
      ? await db.from("dcp_audio_reports").update(payload).eq("id", currentSavedId).select("id").single()
      : await db.from("dcp_audio_reports").insert(payload).select("id").single();
    if (result.error) throw result.error;
    setSavedState(result.data.id);
    toast(wasExisting ? "DCP aggiornato nello storico" : "DCP salvato nello storico");
    return true;
  } catch (error) {
    toast(error.code === "42P01" ? "Esegui prima lo script database incluso" : `Salvataggio non riuscito: ${error.message}`);
    return false;
  } finally { $("#saveButton").disabled = false; }
}

async function saveAndOpenPdf() {
  const saved = await saveDcp();
  if (!saved) return;
  window.setTimeout(() => window.print(), 180);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

async function loadHistory() {
  showView("history");
  const list = $("#historyList");
  list.innerHTML = '<div class="history-loading">Caricamento storico…</div>';
  $("#emptyHistory").classList.add("hidden");
  if (!db) { list.innerHTML = '<div class="history-error">Database non configurato.</div>'; return; }
  const { data, error } = await db.from("dcp_audio_reports").select("id,title,rows,created_at,updated_at").order("updated_at", { ascending: false });
  if (error) { list.innerHTML = `<div class="history-error">Storico non disponibile: ${error.code === "42P01" ? "esegui lo script database incluso" : error.message}</div>`; return; }
  list.replaceChildren();
  $("#emptyHistory").classList.toggle("hidden", data.length > 0);
  data.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-row";
    button.innerHTML = `<span class="history-row-icon">DCP</span><span><strong></strong><small></small></span><em></em><b>›</b>`;
    button.querySelector("strong").textContent = item.title;
    button.querySelector("small").textContent = `${Array.isArray(item.rows) ? item.rows.length : 0} musiche · Aggiornato ${formatDate(item.updated_at)}`;
    button.querySelector("em").textContent = formatDate(item.created_at);
    button.addEventListener("click", () => openSavedDcp(item));
    list.append(button);
  });
}

function openSavedDcp(item) {
  reportRows = cleanStoredRows(item.rows);
  $("#resultTitle").value = item.title;
  audioEntryGrid.classList.add("hidden");
  workspace.classList.remove("hidden");
  $(".file-summary").classList.add("hidden");
  $(".two-column").classList.add("hidden");
  resultsPanel.classList.remove("hidden");
  renderResults();
  setSavedState(item.id);
  showView("audio");
}

async function deleteCurrentDcp() {
  if (!currentSavedId || !confirm(`Eliminare definitivamente “${$("#resultTitle").value.trim()}” dallo storico?`)) return;
  const { error } = await db.from("dcp_audio_reports").delete().eq("id", currentSavedId);
  if (error) return toast(`Eliminazione non riuscita: ${error.message}`);
  toast("DCP eliminato dallo storico");
  newDcp();
}

$("#openAudio").addEventListener("click", () => showView("audio"));
$("#openAudioNav").addEventListener("click", () => showView("audio"));
$("#iphoneAudioNav").addEventListener("click", () => showView("audio"));
$("#openHomeNav").addEventListener("click", () => showView("home"));
$("#iphoneHomeNav").addEventListener("click", () => showView("home"));
$("#homeButton").addEventListener("click", () => showView("home"));
$("#iphoneBrand").addEventListener("click", () => showView("home"));
$("#openInfoNav").addEventListener("click", () => showView("info"));
$("#infoBackButton").addEventListener("click", () => showView("home"));
$("#backButton").addEventListener("click", () => showView("home"));
$("#browseButton").addEventListener("click", () => fileInput.click());
$("#changeFile").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => loadFile(fileInput.files[0]));
["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add("dragover"); }));
["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove("dragover"); }));
dropZone.addEventListener("drop", (event) => loadFile(event.dataTransfer.files[0]));
$("#toggleTracks").addEventListener("click", () => {
  const allSelected = parsedEdl.audioTracks.every((track) => selectedTracks.has(track));
  selectedTracks = new Set(allSelected ? [] : parsedEdl.audioTracks);
  localStorage.setItem("dvs-audio-tracks", JSON.stringify([...selectedTracks]));
  renderTracks();
});
$("#generateButton").addEventListener("click", generateReport);
$("#copyButton").addEventListener("click", async () => { await navigator.clipboard.writeText(currentText()); toast("Elenco copiato"); });
$("#csvButton").addEventListener("click", downloadCsv);
$("#printButton").addEventListener("click", saveAndOpenPdf);
$("#saveButton").addEventListener("click", saveDcp);
$("#newDcpButton").addEventListener("click", newDcp);
$("#deleteDcpButton").addEventListener("click", deleteCurrentDcp);
$("#openHistoryButton").addEventListener("click", loadHistory);
$("#historyBackButton").addEventListener("click", () => showView("audio"));
$("#historyBackInline").addEventListener("click", () => showView("audio"));
$("#historyNewDcp").addEventListener("click", newDcp);

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}
