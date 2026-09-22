import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

assert.match(html, /id="fileInput"[^>]*multiple/);
assert.match(html, /id="videoFileInput"[^>]*multiple/);
assert.match(html, /id="audioBatchList"/);
assert.match(html, /id="videoBatchList"/);
assert.match(app, /loadEdlBatch\(files, "audio"\)/);
assert.match(app, /loadEdlBatch\(files, "video"\)/);
assert.match(app, /dataset\.printMode = `\$\{item\.type\}-batch`/);
assert.match(app, /report_type: item\.type/);

console.log("Importazione multipla EDL indipendente: test superato");
