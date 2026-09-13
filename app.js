import { buildAudioReport, buildVideoReport, framesToTc, parseEdl } from "./parser.js";

const $ = (selector) => document.querySelector(selector);
const views = {
  home: $("#homeView"), audio: $("#audioView"), video: $("#videoView"),
  calculator: $("#calculatorView"), history: $("#historyView"), info: $("#infoView")
};
const hasDatabase = Boolean(window.DVS_SUPABASE?.url && window.DVS_SUPABASE?.publishableKey && window.supabase?.createClient);
const db = hasDatabase ? window.supabase.createClient(window.DVS_SUPABASE.url, window.DVS_SUPABASE.publishableKey) : null;

let parsedAudioEdl = null;
let currentAudioFile = null;
let selectedAudioTracks = new Set();
let audioRows = [];
let currentAudioSavedId = null;

let parsedVideoEdl = null;
let currentVideoFile = null;
let selectedVideoTracks = new Set();
let videoRows = [];
let currentVideoSavedId = null;
let historyOrigin = "audio";

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
  $("#openHomeNav").classList.toggle("active", name === "home");
  $("#openAudioNav").classList.toggle("active", inAudio);
  $("#openVideoNav").classList.toggle("active", inVideo);
  $("#openCalculatorNav").classList.toggle("active", name === "calculator");
  $("#openInfoNav").classList.toggle("active", name === "info");
  $("#iphoneHomeNav").classList.toggle("active", name === "home");
  $("#iphoneAudioNav").classList.toggle("active", inAudio);
  $("#iphoneVideoNav").classList.toggle("active", inVideo);
  $("#iphoneCalculatorNav").classList.toggle("active", name === "calculator");
  $(".iphone-bottom-nav").dataset.active = inVideo ? "2" : name === "calculator" ? "3" : inAudio ? "1" : "0";
  $("#iphoneSectionTitle").textContent = name === "history" ? "STORICO DCP" : name === "audio" ? "DCP AUDIO" : name === "video" ? "DCP VIDEO" : name === "calculator" ? "TIMECODE" : name === "info" ? "INFORMAZIONI" : "UTILITY";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function readSavedTracks(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); }
  catch { return []; }
}

function setupDropZone(zone, input, loader) {
  ["dragenter", "dragover"].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.remove("dragover"); }));
  zone.addEventListener("drop", (event) => loader(event.dataTransfer.files[0]));
  input.addEventListener("change", () => loader(input.files[0]));
}

function renderTrackButtons(container, tracks, selected, storageKey, toggleButton) {
  container.replaceChildren();
  tracks.forEach((track) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `track-button${selected.has(track) ? " active" : ""}`;
    button.textContent = track;
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

// DCP AUDIO
const audioEntryGrid = $("#audioEntryGrid");
const audioWorkspace = $("#workspace");
const audioResults = $("#resultsPanel");
const audioFileInput = $("#fileInput");

function showAudioLanding() {
  audioEntryGrid.classList.remove("hidden");
  audioWorkspace.classList.add("hidden");
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
    const duration = document.createElement("td"); duration.className = "duration-column"; duration.textContent = row.duration;
    const action = document.createElement("td"); action.className = "action-column";
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-button"; remove.textContent = "×"; remove.title = "Elimina definitivamente questa riga";
    remove.addEventListener("click", () => { videoRows = videoRows.filter((item) => item.id !== row.id); renderVideoRows(); });
    action.append(remove); tr.append(selectCell, number, nameCell, duration, action); body.append(tr);
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

// STORICO UNICO AUDIO / VIDEO
function formatDate(value) {
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

async function loadHistory(origin = "audio") {
  historyOrigin = origin;
  $("#historyNewDcp").textContent = origin === "video" ? "+ Nuovo DCP Video" : "+ Nuovo DCP Audio";
  showView("history");
  const list = $("#historyList"); list.innerHTML = '<div class="history-loading">Caricamento storico…</div>';
  $("#emptyHistory").classList.add("hidden");
  if (!db) { list.innerHTML = '<div class="history-error">Database non configurato.</div>'; return; }
  const { data, error } = await db.from("dcp_audio_reports").select("id,title,report_type,rows,created_at,updated_at").order("updated_at", { ascending: false });
  if (error) { list.innerHTML = `<div class="history-error">Storico non disponibile: ${error.code === "42703" ? "esegui la migrazione database della nuova versione" : error.message}</div>`; return; }
  list.replaceChildren(); $("#emptyHistory").classList.toggle("hidden", data.length > 0);
  data.forEach((item) => {
    const type = item.report_type === "video" ? "video" : "audio";
    const button = document.createElement("button"); button.type = "button"; button.className = "history-row";
    button.innerHTML = `<span class="history-row-icon"></span><span><strong></strong><small></small></span><em></em><b>›</b>`;
    button.querySelector(".history-row-icon").textContent = type === "video" ? "VIDEO" : "AUDIO";
    button.querySelector("strong").textContent = item.title;
    button.querySelector("small").textContent = `${Array.isArray(item.rows) ? item.rows.length : 0} righe · Aggiornato ${formatDate(item.updated_at)}`;
    button.querySelector("em").textContent = formatDate(item.created_at);
    button.addEventListener("click", () => openSavedReport({ ...item, report_type: type })); list.append(button);
  });
}

function openSavedReport(item) {
  if (item.report_type === "video") {
    videoRows = cleanRows(item.rows, "video").sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base", numeric: true }));
    $("#videoResultTitle").value = item.title; $("#videoSearchInput").value = ""; currentVideoSavedId = item.id;
    videoEntryGrid.classList.add("hidden"); videoWorkspace.classList.remove("hidden"); $("#videoFileSummary").classList.add("hidden"); $("#videoControls").classList.add("hidden");
    videoResults.classList.remove("hidden"); $("#videoBackButton").classList.remove("hidden"); updateVideoSaveButtons(); renderVideoRows(); showView("video");
  } else {
    audioRows = cleanRows(item.rows, "audio"); $("#resultTitle").value = item.title; currentAudioSavedId = item.id;
    audioEntryGrid.classList.add("hidden"); audioWorkspace.classList.remove("hidden"); $(".file-summary").classList.add("hidden"); $(".work-controls").classList.add("hidden");
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
    row.querySelector("span").textContent = entry.expression; row.querySelector("strong").textContent = entry.result; row.querySelector("small").textContent = `${entry.fps} fps`; list.append(row);
  });
}

function enteredFramesSilently() {
  const [hh, mm, ss, ff] = digitsToTc(calcDigits).split(":").map(Number);
  return (((hh * 60 + mm) * 60 + ss) * calcFps) + ff;
}

function resetCalculation() { calcDigits = ""; calcAccumulator = null; calcOperator = null; calcShowingResult = false; renderCalculator(); }

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
  calcDigits = ""; calcOperator = operator; calcShowingResult = false; renderCalculator();
}

function applyCalculation(first, second, operator, record = true) {
  if (operator === "range" && second < first) { toast("Il timecode finale deve essere successivo a quello iniziale"); return first; }
  const result = operator === "add" ? first + second : operator === "subtract" ? Math.max(0, first - second) : second - first;
  if (record) calcHistory.push({ expression: `${framesToTc(first, calcFps)} ${calcSymbol(operator)} ${framesToTc(second, calcFps)}`, result: framesToTc(result, calcFps), fps: calcFps });
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

// NAVIGAZIONE E AZIONI
$("#openAudio").addEventListener("click", showAudioLanding);
$("#openAudioNav").addEventListener("click", showAudioLanding);
$("#iphoneAudioNav").addEventListener("click", showAudioLanding);
$("#openVideo").addEventListener("click", showVideoLanding);
$("#openVideoNav").addEventListener("click", showVideoLanding);
$("#iphoneVideoNav").addEventListener("click", showVideoLanding);
$("#openCalculator").addEventListener("click", () => showView("calculator"));
$("#openCalculatorNav").addEventListener("click", () => showView("calculator"));
$("#iphoneCalculatorNav").addEventListener("click", () => showView("calculator"));
$("#openHomeNav").addEventListener("click", () => showView("home"));
$("#iphoneHomeNav").addEventListener("click", () => showView("home"));
$("#homeButton").addEventListener("click", () => showView("home"));
$("#iphoneBrand").addEventListener("click", () => showView("home"));
$("#openInfoNav").addEventListener("click", () => showView("info"));
$("#infoBackButton").addEventListener("click", () => showView("home"));

$("#backButton").addEventListener("click", showAudioLanding);
$("#browseButton").addEventListener("click", () => audioFileInput.click());
$("#changeFile").addEventListener("click", () => audioFileInput.click());
setupDropZone($("#dropZone"), audioFileInput, loadAudioFile);
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
setupDropZone($("#videoDropZone"), videoFileInput, loadVideoFile);
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

$("#openHistoryButton").addEventListener("click", () => loadHistory("audio"));
$("#openVideoHistoryButton").addEventListener("click", () => loadHistory("video"));
$("#historyBackButton").addEventListener("click", () => historyOrigin === "video" ? showVideoLanding() : showAudioLanding());
$("#historyBackInline").addEventListener("click", () => historyOrigin === "video" ? showVideoLanding() : showAudioLanding());
$("#historyNewDcp").addEventListener("click", () => historyOrigin === "video" ? newVideoDcp() : newAudioDcp());

$("#fpsSelector").addEventListener("click", (event) => { const button = event.target.closest("button[data-fps]"); if (!button) return; calcFps = Number(button.dataset.fps); $("#fpsSelector").querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button)); $("#fpsLabel").textContent = `${calcFps} fps`; resetCalculation(); });
$("#calculatorKeypad").addEventListener("click", (event) => { const button = event.target.closest("button"); if (!button) return; if (button.dataset.digit != null) enterDigit(button.dataset.digit); else if (button.dataset.action) calculatorAction(button.dataset.action); });
$("#clearCalculatorHistory").addEventListener("click", () => { calcHistory = []; renderCalculator(); });
window.addEventListener("keydown", (event) => { if (!views.calculator.classList.contains("active")) return; if (/^\d$/.test(event.key)) enterDigit(event.key); else if (event.key === "Backspace") calculatorAction("backspace"); else if (event.key === "+") calculatorAction("add"); else if (event.key === "-") calculatorAction("subtract"); else if (event.key === "Enter" || event.key === "=") calculatorAction("equals"); else if (event.key === "Escape") calculatorAction("clear"); });

function downloadCsv(title, rows) {
  const selected = rows.filter((row) => row.selected !== false);
  const data = [["N.", "Nome", "Durata"], ...selected.map((row, index) => [index + 1, row.name, row.duration])];
  const csv = data.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${title}.csv`.replace(/[\\/:*?"<>|]/g, "-"); anchor.click(); URL.revokeObjectURL(url);
}

renderCalculator();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
