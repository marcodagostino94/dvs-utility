import assert from "node:assert/strict";
import { filterHistoryItems } from "../history.js";

const reports = [
  { title: "Puntata Roma", report_type: "audio" },
  { title: "Puntata Roma", report_type: "video" },
  { title: "Servizio Milano", report_type: "audio" }
];

assert.deepEqual(filterHistoryItems(reports, "audio").map((item) => item.report_type), ["audio", "audio"]);
assert.deepEqual(filterHistoryItems(reports, "video").map((item) => item.report_type), ["video"]);
assert.deepEqual(filterHistoryItems(reports, "audio", "roma").map((item) => item.title), ["Puntata Roma"]);
assert.equal(filterHistoryItems(reports, "video", "milano").length, 0);

console.log("Storici DCP separati e ricerca: test superato");
