const TC_RE = /^(\d{2}):(\d{2}):(\d{2}):(\d{2})$/;

export function tcToFrames(tc, fps = 25) {
  const match = String(tc || "").match(TC_RE);
  if (!match) return null;
  const [, hh, mm, ss, ff] = match.map(Number);
  return (((hh * 60 + mm) * 60 + ss) * fps) + ff;
}

export function framesToTc(frames, fps = 25) {
  let value = Math.max(0, Math.round(frames));
  const ff = value % fps;
  value = Math.floor(value / fps);
  const ss = value % 60;
  value = Math.floor(value / 60);
  const mm = value % 60;
  const hh = Math.floor(value / 60);
  return [hh, mm, ss, ff].map((part) => String(part).padStart(2, "0")).join(":");
}

function normalizeTrack(track) {
  return track === "A" ? "A1" : track;
}

function cleanName(value) {
  const name = String(value || "").trim();
  if (!name || /^\(?NULL\)?$/i.test(name) || name === "BL") return "";
  return name.replace(/\s+/g, " ");
}

function canonicalName(value) {
  return cleanName(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s]+/g, " ")
    .trim()
    .toLocaleUpperCase("it");
}

function canonicalStem(value) {
  return canonicalName(value).replace(/\.(WAV|MP3|AIFF?|M4A|AAC|FLAC)$/i, "");
}

function displayFromReel(reel) {
  return cleanName(reel).replace(/_/g, " ");
}

function parseSourceTable(lines) {
  const map = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith(">>> SOURCE ")) continue;
    const reel = cleanName(line.slice(11).split(/\s{2,}/)[0]);
    const next = lines[index + 1] || "";
    const sourceMatch = next.match(/^\*SOURCE FILE:\s*(.*)$/i);
    if (reel && sourceMatch) map.set(canonicalName(reel), cleanName(sourceMatch[1]));
  }
  return map;
}

function parseBlocks(lines) {
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const numbered = line.match(/^(\d{6})\s+/);
    if (numbered) {
      const eventNumber = numbered[1];
      if (!current || current.eventNumber !== eventNumber) {
        if (current) blocks.push(current);
        current = { eventNumber, eventLines: [], comments: [] };
      }
      current.eventLines.push(line);
    } else if (current && line.startsWith("*")) {
      current.comments.push(line);
    } else if (current && line.startsWith(">>> SOURCE")) {
      blocks.push(current);
      current = null;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function commentValue(comments, label) {
  const prefix = `*${label}:`;
  const line = comments.find((entry) => entry.toUpperCase().startsWith(prefix));
  return line ? cleanName(line.slice(prefix.length)) : "";
}

function parseEventLine(line, fps) {
  const match = line.match(/^(\d{6})\s+(.+?)\s+(A\d*|V\d*)\s+(C|D)(?:\s+(\d+))?\s+(\d{2}:\d{2}:\d{2}:\d{2})\s+(\d{2}:\d{2}:\d{2}:\d{2})\s+(\d{2}:\d{2}:\d{2}:\d{2})\s+(\d{2}:\d{2}:\d{2}:\d{2})\s*$/);
  if (!match) return null;
  const [, eventNumber, reel, track, editType, transitionFrames, sourceIn, sourceOut, recordIn, recordOut] = match;
  return {
    eventNumber,
    reel: cleanName(reel),
    track: normalizeTrack(track),
    editType,
    transitionFrames: Number(transitionFrames || 0),
    sourceIn,
    sourceOut,
    recordIn,
    recordOut,
    start: tcToFrames(recordIn, fps),
    end: tcToFrames(recordOut, fps),
  };
}

export function parseEdl(text, fps = 25) {
  const normalized = String(text || "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const title = cleanName((lines.find((line) => line.startsWith("TITLE:")) || "").slice(6));
  const sourceTable = parseSourceTable(lines);
  const blocks = parseBlocks(lines);
  const intervals = [];

  for (const block of blocks) {
    const parsedLines = block.eventLines.map((line) => parseEventLine(line, fps)).filter(Boolean);
    const fromName = commentValue(block.comments, "FROM CLIP NAME");
    const toName = commentValue(block.comments, "TO CLIP NAME");
    const sourceFile = commentValue(block.comments, "SOURCE FILE");

    for (const event of parsedLines) {
      if (event.start == null || event.end == null || event.end <= event.start) continue;
      const mappedReel = sourceTable.get(canonicalName(event.reel));

      if (event.editType === "C") {
        if (event.reel === "BL") continue;
        const name = sourceFile || mappedReel || fromName || displayFromReel(event.reel);
        if (name) intervals.push({ ...event, name, kind: "clip" });
        continue;
      }

      const candidates = [];
      if (event.reel === "BL") {
        candidates.push(sourceFile || fromName);
      } else if (fromName && toName && canonicalName(fromName) !== canonicalName(toName)) {
        candidates.push(fromName, sourceFile || toName || mappedReel || displayFromReel(event.reel));
      } else {
        candidates.push(sourceFile || toName || fromName || mappedReel || displayFromReel(event.reel));
      }

      for (const candidate of new Set(candidates.map(cleanName).filter(Boolean))) {
        intervals.push({ ...event, name: candidate, kind: "dissolve" });
      }
    }
  }

  // A fade from black can expose only the clip name (for example DONAY),
  // while the following cut exposes the full source name (DONAY.MP3).
  const preferredNames = new Map();
  for (const interval of intervals) {
    const stem = canonicalStem(interval.name);
    const current = preferredNames.get(stem) || "";
    const hasExtension = /\.[A-Z0-9]{2,5}$/i.test(interval.name);
    const currentHasExtension = /\.[A-Z0-9]{2,5}$/i.test(current);
    if (!current || (hasExtension && !currentHasExtension) || (hasExtension === currentHasExtension && interval.name.length > current.length)) {
      preferredNames.set(stem, interval.name);
    }
  }
  for (const interval of intervals) {
    interval.name = preferredNames.get(canonicalStem(interval.name)) || interval.name;
  }

  const audioTracks = [...new Set(intervals.filter((item) => item.track.startsWith("A")).map((item) => item.track))]
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const videoTracks = [...new Set(intervals.filter((item) => item.track.startsWith("V")).map((item) => item.track))]
    .sort((a, b) => Number(a.slice(1) || 1) - Number(b.slice(1) || 1));

  return { title, fps, intervals, audioTracks, videoTracks };
}

function mergeIntervals(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const item of sorted) {
    const previous = merged.at(-1);
    if (previous && item.start <= previous.end) {
      previous.end = Math.max(previous.end, item.end);
      previous.tracks = new Set([...previous.tracks, item.track]);
      previous.kinds = new Set([...previous.kinds, item.kind]);
    } else {
      merged.push({
        start: item.start,
        end: item.end,
        tracks: new Set([item.track]),
        kinds: new Set([item.kind]),
      });
    }
  }
  return merged;
}

function buildTrackReport(parsed, selectedTracks, prefix) {
  const selected = new Set(selectedTracks.map(normalizeTrack));
  const matching = parsed.intervals.filter((item) => item.track.startsWith(prefix) && selected.has(item.track));

  // Identical timeline uses on multiple tracks are stereo duplicates.
  const uniqueMap = new Map();
  for (const item of matching) {
    const key = `${canonicalName(item.name)}|${item.start}|${item.end}|${item.kind}`;
    const existing = uniqueMap.get(key);
    if (existing) {
      existing.tracks.add(item.track);
    } else {
      uniqueMap.set(key, { ...item, tracks: new Set([item.track]) });
    }
  }
  const unique = [...uniqueMap.values()];

  const nameGroups = new Map();
  for (const item of unique) {
    const key = canonicalName(item.name);
    if (!nameGroups.has(key)) nameGroups.set(key, { key, name: item.name, items: [] });
    const group = nameGroups.get(key);
    if (item.name.length > group.name.length) group.name = item.name;
    group.items.push(item);
  }

  const mergedByName = new Map();
  for (const [key, group] of nameGroups) {
    mergedByName.set(key, { ...group, spans: mergeIntervals(group.items) });
  }

  const allSpans = [];
  for (const [key, group] of mergedByName) {
    for (const span of group.spans) allSpans.push({ ...span, key });
  }

  const report = [];
  for (const [key, group] of mergedByName) {
    let current = null;
    for (const span of group.spans) {
      const interrupted = current && allSpans.some((other) =>
        other.key !== key && other.start < span.start && other.end > current.lastEnd
      );
      if (!current || interrupted) {
        current = {
          key,
          name: group.name,
          start: span.start,
          lastEnd: span.end,
          frames: span.end - span.start,
          tracks: new Set(span.tracks),
          hasDissolve: span.kinds.has("dissolve"),
        };
        report.push(current);
      } else {
        current.frames += span.end - span.start;
        current.lastEnd = span.end;
        current.tracks = new Set([...current.tracks, ...span.tracks]);
        current.hasDissolve ||= span.kinds.has("dissolve");
      }
    }
  }

  return report
    .sort((a, b) => a.start - b.start || a.name.localeCompare(b.name, "it"))
    .map((item, index) => ({
      id: `${item.key}-${item.start}-${index}`,
      order: index + 1,
      name: item.name,
      frames: item.frames,
      duration: framesToTc(item.frames, parsed.fps),
      tracks: [...item.tracks].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))),
      hasDissolve: item.hasDissolve,
    }));
}

export function buildAudioReport(parsed, selectedTracks) {
  return buildTrackReport(parsed, selectedTracks, "A");
}

export function buildVideoReport(parsed, selectedTracks) {
  return buildTrackReport(parsed, selectedTracks, "V")
    .sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base", numeric: true }))
    .map((row, index) => ({ ...row, order: index + 1, selected: false }));
}
