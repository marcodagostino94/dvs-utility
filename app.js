import { buildAudioReport, parseEdl } from "./parser.js";

const $ = (selector) => document.querySelector(selector);
const homeView = $("#homeView");
const audioView = $("#audioView");
const fileInput = $("#fileInput");
const dropZone = $("#dropZone");
const workspace = $("#workspace");
const resultsPanel = $("#resultsPanel");
const trackGrid = $("#trackGrid");
const resultBody = $("#resultBody");
const tableWrap = $("#tableWrap");
const emptyResult = $("#emptyResult");

let parsedEdl = null;
let currentFile = null;
let selectedTracks = new Set();
let reportRows = [];

function showView(view) {
  homeView.classList.toggle("active", view === "home");
  audioView.classList.toggle("active", view === "audio");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.remove("show"), 1800);
}

function savedTracks() {
  try { return JSON.parse(localStorage.getItem("dvs-audio-tracks") || "[]"); }
  catch { return []; }
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
  if (!file || !/\.(edl|txt)$/i.test(file.name)) {
    toast("Seleziona un file EDL valido");
    return;
  }
  const text = await file.text();
  const parsed = parseEdl(text, 25);
  if (!parsed.intervals.length) {
    toast("Nessun evento leggibile nell’EDL");
    return;
  }
  currentFile = file;
  parsedEdl = parsed;
  const previous = savedTracks().filter((track) => parsed.audioTracks.includes(track));
  selectedTracks = new Set(previous.length ? previous : parsed.audioTracks);
  $("#fileName").textContent = file.name;
  $("#fileDetails").textContent = `${parsed.title || "Sequenza Avid"} · ${parsed.audioTracks.length} tracce audio · ${parsed.videoTracks.length} tracce video rilevate`;
  dropZone.classList.add("hidden");
  workspace.classList.remove("hidden");
  resultsPanel.classList.add("hidden");
  renderTracks();
}

function renderResults() {
  resultBody.replaceChildren();
  reportRows.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.dataset.id = row.id;

    const order = document.createElement("td");
    order.className = "number-column";
    order.textContent = String(index + 1);

    const nameCell = document.createElement("td");
    nameCell.className = "file-name-cell";
    const input = document.createElement("input");
    input.className = "file-name-input";
    input.value = row.name;
    input.setAttribute("aria-label", `Nome musica ${index + 1}`);
    input.addEventListener("change", () => { row.name = input.value.trim() || row.name; });
    nameCell.append(input);

    const tracksCell = document.createElement("td");
    const tags = document.createElement("div");
    tags.className = "track-tags";
    row.tracks.forEach((track) => {
      const tag = document.createElement("span");
      tag.className = "track-tag";
      tag.textContent = track;
      tags.append(tag);
    });
    tracksCell.append(tags);

    const duration = document.createElement("td");
    duration.className = "duration-column";
    duration.textContent = row.duration;

    const action = document.createElement("td");
    action.className = "action-column";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-button";
    remove.textContent = "×";
    remove.title = "Escludi dal rapporto";
    remove.addEventListener("click", () => {
      reportRows = reportRows.filter((item) => item.id !== row.id);
      renderResults();
    });
    action.append(remove);
    tr.append(order, nameCell, tracksCell, duration, action);
    resultBody.append(tr);
  });

  $("#resultSummary").textContent = `${reportRows.length} ${reportRows.length === 1 ? "utilizzo musicale" : "utilizzi musicali"} · Timecode 25 fps`;
  emptyResult.classList.toggle("hidden", reportRows.length > 0);
  tableWrap.classList.toggle("hidden", reportRows.length === 0);
}

function generateReport() {
  if (!selectedTracks.size) {
    toast("Seleziona almeno una traccia musicale");
    return;
  }
  reportRows = buildAudioReport(parsedEdl, [...selectedTracks]);
  $("#resultTitle").textContent = parsedEdl.title || currentFile.name.replace(/\.[^.]+$/, "");
  renderResults();
  resultsPanel.classList.remove("hidden");
  resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function currentText() {
  return reportRows.map((row, index) => `${index + 1}. ${row.name} — ${row.duration}`).join("\n");
}

function downloadCsv() {
  const rows = [
    ["N.", "File musicale", "Tracce", "Durata (25 fps)"],
    ...reportRows.map((row, index) => [index + 1, row.name, row.tracks.join(" / "), row.duration]),
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";")).join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${parsedEdl.title || "DCP-Audio"}.csv`.replace(/[\\/:*?"<>|]/g, "-");
  anchor.click();
  URL.revokeObjectURL(url);
}

$("#openAudio").addEventListener("click", () => showView("audio"));
$("#homeButton").addEventListener("click", () => showView("home"));
$("#backButton").addEventListener("click", () => showView("home"));
$("#browseButton").addEventListener("click", () => fileInput.click());
$("#changeFile").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => loadFile(fileInput.files[0]));

["dragenter", "dragover"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.add("dragover");
}));
["dragleave", "drop"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragover");
}));
dropZone.addEventListener("drop", (event) => loadFile(event.dataTransfer.files[0]));

$("#toggleTracks").addEventListener("click", () => {
  const allSelected = parsedEdl.audioTracks.every((track) => selectedTracks.has(track));
  selectedTracks = new Set(allSelected ? [] : parsedEdl.audioTracks);
  localStorage.setItem("dvs-audio-tracks", JSON.stringify([...selectedTracks]));
  renderTracks();
});
$("#generateButton").addEventListener("click", generateReport);
$("#copyButton").addEventListener("click", async () => {
  await navigator.clipboard.writeText(currentText());
  toast("Elenco copiato");
});
$("#csvButton").addEventListener("click", downloadCsv);
$("#printButton").addEventListener("click", () => window.print());

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}
