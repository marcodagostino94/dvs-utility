import assert from "node:assert/strict";
import { technicalDuration, technicalTcFrames } from "../technical.js";

assert.equal(technicalTcFrames("01:00:02:12"), 90062);
assert.equal(technicalTcFrames("00:00:00:25"), null);
assert.equal(technicalDuration("01:00:02:12", "01:04:12:13"), "04:10:01");
assert.equal(technicalDuration("01:59:59:24", "02:00:00:00"), "00:00:01");
assert.equal(technicalDuration("02:00:00:00", "01:00:00:00"), "");

console.log("Scheda Tecnica: calcolo durata superato");
