import assert from "node:assert/strict";
import fs from "node:fs";
import { buildAudioReport, buildVideoReport, parseEdl } from "../parser.js";

const unitFixture = `TITLE: TEST
FCM: NON-DROP FRAME
000001  YELLOW.MP3  A5  C  00:00:00:00 00:00:10:00 01:00:00:00 01:00:10:00
*FROM CLIP NAME: YELLOW
*SOURCE FILE: YELLOW.MP3
000002  YELLOW.MP3  A6  C  00:00:00:00 00:00:10:00 01:00:00:00 01:00:10:00
*FROM CLIP NAME: YELLOW
*SOURCE FILE: YELLOW.MP3
000003  YELLOW.MP3  A5  C  00:00:10:00 00:00:10:00 01:00:10:00 01:00:10:00
000003  BL  A5  D  050 00:00:00:00 00:00:02:00 01:00:10:00 01:00:12:00
*BLEND, AUDIO DISSOLVE
*FROM CLIP NAME: YELLOW
*SOURCE FILE: YELLOW.MP3
000004  YELLOW.MP3  A6  C  00:00:10:00 00:00:10:00 01:00:10:00 01:00:10:00
000004  BL  A6  D  050 00:00:00:00 00:00:02:00 01:00:10:00 01:00:12:00
*BLEND, AUDIO DISSOLVE
*FROM CLIP NAME: YELLOW
*SOURCE FILE: YELLOW.MP3
000005  YELLOW.MP3  A5  C  00:00:20:00 00:00:25:00 01:00:20:00 01:00:25:00
*FROM CLIP NAME: YELLOW
*SOURCE FILE: YELLOW.MP3
000006  GIULIA.WAV  A7  C  00:00:00:00 00:00:04:00 01:00:30:00 01:00:34:00
*FROM CLIP NAME: GIULIA
*SOURCE FILE: GIULIA.WAV
000007  YELLOW.MP3  A5  C  00:00:30:00 00:00:33:00 01:00:40:00 01:00:43:00
*FROM CLIP NAME: YELLOW
*SOURCE FILE: YELLOW.MP3
000008  BL  A7  C  00:00:00:00 00:00:00:00 01:00:50:00 01:00:50:00
000008  DONAY  A7  D  050 00:00:00:00 00:00:02:00 01:00:50:00 01:00:52:00
*BLEND, AUDIO DISSOLVE
*TO CLIP NAME: DONAY
*SOURCE FILE: (NULL)
000009  DONAY.MP3  A7  C  00:00:02:00 00:00:05:00 01:00:52:00 01:00:55:00
*FROM CLIP NAME: DONAY
*SOURCE FILE: DONAY.MP3`;

const unitReport = buildAudioReport(parseEdl(unitFixture, 25), ["A5", "A6", "A7"]);
assert.deepEqual(unitReport.map(({ name, duration }) => [name, duration]), [
  ["YELLOW.MP3", "00:00:17:00"],
  ["GIULIA.WAV", "00:00:04:00"],
  ["YELLOW.MP3", "00:00:03:00"],
  ["DONAY.MP3", "00:00:05:00"],
]);

const videoFixture = `TITLE: VIDEO TEST
FCM: NON-DROP FRAME
000001  ZEBRA.MOV  V1  C  00:00:00:00 00:00:10:00 01:00:00:00 01:00:10:00
*FROM CLIP NAME: ZEBRA
*SOURCE FILE: ZEBRA.MOV
000002  GETTY_002.JPG  V2  C  00:00:00:00 00:00:05:00 01:00:10:00 01:00:15:00
*FROM CLIP NAME: GETTY 002
*SOURCE FILE: GETTY 002.JPG
000003  ALFA.MOV  V1  C  00:00:00:00 00:00:03:12 01:00:15:00 01:00:18:12
*FROM CLIP NAME: ALFA
*SOURCE FILE: ALFA.MOV`;
const parsedVideo = parseEdl(videoFixture, 25);
assert.deepEqual(parsedVideo.videoTracks, ["V1", "V2"]);
assert.deepEqual(buildVideoReport(parsedVideo, ["V1", "V2"]).map(({ name, duration, selected }) => [name, duration, selected]), [
  ["ALFA.MOV", "00:00:03:12", false],
  ["GETTY 002.JPG", "00:00:05:00", false],
  ["ZEBRA.MOV", "00:00:10:00", false],
]);

const integrationPath = process.env.DVS_EDL_TEST_FILE;
if (integrationPath && fs.existsSync(integrationPath)) {
  const fixture = fs.readFileSync(integrationPath, "utf8");
  const parsed = parseEdl(fixture, 25);
  const report = buildAudioReport(parsed, ["A5", "A6", "A7", "A8"]);

  assert.deepEqual(report.map(({ name, duration }) => [name, duration]), [
    ["DONATELLA.MP3", "00:02:10:09"],
    ["DISTRETTO DUE.MP3", "00:02:08:21"],
    ["BACK IN TIME - LUCA SCOTA - EDIZIONI PAGINA3.AIFF", "00:01:37:07"],
    ["DONATELLA.MP3", "00:00:17:20"],
    ["AWAKENING EPIC POWERFUL ORCHESTRAL MUSIC MIX - LUCA SCOTA - EDIZIONI PAGINA3.WAV", "00:01:30:02"],
    ["AFTER STORM-LUCA SCOTA-EDIZIONE PAGINA3.WAV", "00:03:59:14"],
    ["AFGANISTAN.MP3", "00:01:02:23"],
    ["DONAY.MP3", "00:00:29:16"],
    ["AFGANISTAN.MP3", "00:00:29:02"],
  ]);

  assert.deepEqual(parsed.audioTracks, ["A1", "A2", "A5", "A6", "A7", "A8"]);
}
console.log("Parser DCP Audio e Video: test superato");
