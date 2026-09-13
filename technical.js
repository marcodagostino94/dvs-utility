export function technicalTcFrames(value, fps = 25) {
  const parts = String(value || "").trim().split(":").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
  const [hours, minutes, seconds, frames] = parts;
  if (minutes > 59 || seconds > 59 || frames >= fps) return null;
  return (((hours * 60 + minutes) * 60 + seconds) * fps) + frames;
}

export function technicalDuration(start, end, fps = 25) {
  const from = technicalTcFrames(start, fps); const to = technicalTcFrames(end, fps);
  if (from == null || to == null || to < from) return "";
  const difference = to - from;
  const minutes = Math.floor(difference / (fps * 60));
  const seconds = Math.floor(difference / fps) % 60;
  const frames = difference % fps;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}
