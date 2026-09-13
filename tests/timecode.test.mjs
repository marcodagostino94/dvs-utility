import assert from "node:assert/strict";
import { framesToTc, tcToFrames } from "../parser.js";

for (const fps of [24, 25, 30, 60]) {
  assert.equal(framesToTc(tcToFrames("01:02:03:04", fps), fps), "01:02:03:04");
}

const fps = 25;
assert.equal(
  framesToTc(tcToFrames("00:01:00:01", fps) + tcToFrames("00:01:03:24", fps), fps),
  "00:02:04:00"
);
assert.equal(
  framesToTc(tcToFrames("02:04:12:13", fps) - tcToFrames("01:00:02:12", fps), fps),
  "01:04:10:01"
);

console.log("Calcolatrice Timecode: test superato");
