import assert from "node:assert/strict";
import { analyzeWav, normalizeWav, parseWav } from "../loudness.js";

globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);

function makeStereoWav(seconds = 6, amplitude = 0.1) {
  const sampleRate = 48000; const channels = 2; const frames = sampleRate * seconds; const dataBytes = frames * channels * 2;
  const buffer = new ArrayBuffer(44 + dataBytes); const view = new DataView(buffer);
  const ascii = (offset, text) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, 36 + dataBytes, true); ascii(8, "WAVE"); ascii(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    const sample = Math.round(Math.sin(2 * Math.PI * 1000 * frame / sampleRate) * amplitude * 32767);
    for (let channel = 0; channel < channels; channel += 1) { view.setInt16(offset, sample, true); offset += 2; }
  }
  return buffer;
}

const source = parseWav(makeStereoWav());
assert.equal(source.sampleRate, 48000);
assert.equal(source.channels, 2);
const original = await analyzeWav(source);
assert.ok(original.integrated > -20.2 && original.integrated < -19.8);
const normalized = await normalizeWav(source, original);
const verified = await analyzeWav(parseWav(await normalized.blob.arrayBuffer()));
assert.ok(verified.integrated >= -23.2 && verified.integrated <= -22.8);
assert.ok(verified.truePeak <= -2);
console.log("Loudness WAV locale: test superato");
