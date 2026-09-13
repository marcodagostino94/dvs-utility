const TARGET_RATE = 48000;
const TARGET_LUFS = -23;
const TRUE_PEAK_LIMIT = -2;

function readAscii(view, offset, length) {
  let value = "";
  for (let i = 0; i < length; i += 1) value += String.fromCharCode(view.getUint8(offset + i));
  return value;
}

export function parseWav(buffer) {
  const view = new DataView(buffer);
  const riff = readAscii(view, 0, 4);
  if (riff !== "RIFF" && riff !== "RF64") throw new Error("Il file non è un WAV PCM valido");
  if (readAscii(view, 8, 4) !== "WAVE") throw new Error("Formato WAV non riconosciuto");
  let offset = 12;
  let format = null;
  let dataOffset = 0;
  let dataSize = 0;
  while (offset + 8 <= view.byteLength) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === "fmt ") {
      let audioFormat = view.getUint16(start, true);
      const channels = view.getUint16(start + 2, true);
      const sampleRate = view.getUint32(start + 4, true);
      const blockAlign = view.getUint16(start + 12, true);
      const bitsPerSample = view.getUint16(start + 14, true);
      if (audioFormat === 0xfffe && size >= 40) audioFormat = view.getUint16(start + 24, true);
      format = { audioFormat, channels, sampleRate, blockAlign, bitsPerSample };
    } else if (id === "data") {
      dataOffset = start;
      dataSize = Math.min(size || view.byteLength - start, view.byteLength - start);
      break;
    }
    offset = start + size + (size % 2);
  }
  if (!format || !dataOffset || !dataSize) throw new Error("Il WAV non contiene una traccia audio leggibile");
  if (![1, 3].includes(format.audioFormat)) throw new Error("Sono supportati WAV PCM e IEEE Float non compressi");
  if (![16, 24, 32, 64].includes(format.bitsPerSample)) throw new Error(`Profondità ${format.bitsPerSample} bit non supportata`);
  const frameCount = Math.floor(dataSize / format.blockAlign);
  const bytesPerSample = format.bitsPerSample / 8;
  const sample = (frame, channel) => {
    const position = dataOffset + frame * format.blockAlign + channel * bytesPerSample;
    if (frame < 0 || frame >= frameCount || position + bytesPerSample > view.byteLength) return 0;
    if (format.audioFormat === 3) return format.bitsPerSample === 64 ? view.getFloat64(position, true) : view.getFloat32(position, true);
    if (format.bitsPerSample === 16) return view.getInt16(position, true) / 32768;
    if (format.bitsPerSample === 24) {
      let value = view.getUint8(position) | (view.getUint8(position + 1) << 8) | (view.getUint8(position + 2) << 16);
      if (value & 0x800000) value |= 0xff000000;
      return value / 8388608;
    }
    return view.getInt32(position, true) / 2147483648;
  };
  return { buffer, view, ...format, dataOffset, dataSize, frameCount, duration: frameCount / format.sampleRate, sample };
}

function biquadSample(x, state, coefficients) {
  const y = coefficients.b0 * x + coefficients.b1 * state.x1 + coefficients.b2 * state.x2 - coefficients.a1 * state.y1 - coefficients.a2 * state.y2;
  state.x2 = state.x1; state.x1 = x; state.y2 = state.y1; state.y1 = y;
  return y;
}

const PRE_FILTER = { b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285, a1: -1.69065929318241, a2: 0.73248077421585 };
const RLB_FILTER = { b0: 1, b1: -2, b2: 1, a1: -1.99004745483398, a2: 0.99007225036621 };

function percentile(values, percentage) {
  if (!values.length) return -Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * percentage;
  const lower = Math.floor(position); const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function loudnessFromEnergy(energy) { return energy > 0 ? -0.691 + 10 * Math.log10(energy) : -Infinity; }
function energyFromLoudness(loudness) { return 10 ** ((loudness + 0.691) / 10); }
function nextPaint() { return new Promise((resolve) => requestAnimationFrame(resolve)); }

function channelWeights(channels) {
  if (channels === 6) return [1, 1, 1, 0, 1.41, 1.41];
  if (channels === 8) return [1, 1, 1, 0, 1.41, 1.41, 1.41, 1.41];
  return Array.from({ length: channels }, () => 1);
}

function interpolatedSample(wav, frame, channel) {
  if (wav.sampleRate === TARGET_RATE) return wav.sample(frame, channel);
  const sourcePosition = frame * wav.sampleRate / TARGET_RATE;
  const left = Math.floor(sourcePosition); const fraction = sourcePosition - left;
  return wav.sample(left, channel) * (1 - fraction) + wav.sample(left + 1, channel) * fraction;
}

function cubic(a, b, c, d, t) {
  const p = (d - c) - (a - b);
  return p * t * t * t + ((a - b) - p) * t * t + (c - a) * t + b;
}

export async function analyzeWav(wav, onProgress = () => {}, signal = { aborted: false }) {
  const outputFrames = Math.floor(wav.duration * TARGET_RATE);
  const segmentFrames = TARGET_RATE / 10;
  const segments = [];
  const waveform = new Float32Array(720);
  const states = Array.from({ length: wav.channels }, () => ({ pre: { x1: 0, x2: 0, y1: 0, y2: 0 }, rlb: { x1: 0, x2: 0, y1: 0, y2: 0 } }));
  const weights = channelWeights(wav.channels);
  let segmentEnergy = 0;
  let segmentSamples = 0;
  let samplePeak = 0;
  const paintEvery = Math.max(segmentFrames * 4, 1);

  for (let frame = 0; frame < outputFrames; frame += 1) {
    if (signal.aborted) throw new DOMException("Analisi annullata", "AbortError");
    let weightedEnergy = 0;
    let framePeak = 0;
    for (let channel = 0; channel < wav.channels; channel += 1) {
      const raw = interpolatedSample(wav, frame, channel);
      framePeak = Math.max(framePeak, Math.abs(raw));
      const pre = biquadSample(raw, states[channel].pre, PRE_FILTER);
      const filtered = biquadSample(pre, states[channel].rlb, RLB_FILTER);
      weightedEnergy += weights[channel] * filtered * filtered;
    }
    samplePeak = Math.max(samplePeak, framePeak);
    segmentEnergy += weightedEnergy;
    segmentSamples += 1;
    const bin = Math.min(waveform.length - 1, Math.floor(frame / outputFrames * waveform.length));
    waveform[bin] = Math.max(waveform[bin], framePeak);
    if (segmentSamples === segmentFrames) { segments.push(segmentEnergy / segmentSamples); segmentEnergy = 0; segmentSamples = 0; }
    if (frame % paintEvery === 0) { onProgress(Math.min(0.82, frame / outputFrames * 0.82), waveform); await nextPaint(); }
  }
  if (segmentSamples) segments.push(segmentEnergy / segmentSamples);

  const blockEnergies = [];
  for (let index = 3; index < segments.length; index += 1) blockEnergies.push((segments[index] + segments[index - 1] + segments[index - 2] + segments[index - 3]) / 4);
  const aboveAbsolute = blockEnergies.filter((energy) => loudnessFromEnergy(energy) >= -70);
  const ungatedEnergy = aboveAbsolute.reduce((sum, value) => sum + value, 0) / Math.max(1, aboveAbsolute.length);
  const relativeGate = loudnessFromEnergy(ungatedEnergy) - 10;
  const gated = aboveAbsolute.filter((energy) => loudnessFromEnergy(energy) >= relativeGate);
  const integratedEnergy = gated.reduce((sum, value) => sum + value, 0) / Math.max(1, gated.length);
  const integrated = loudnessFromEnergy(integratedEnergy);

  const shortTerms = [];
  for (let index = 29; index < segments.length; index += 10) {
    let energy = 0; for (let j = index - 29; j <= index; j += 1) energy += segments[j];
    shortTerms.push(loudnessFromEnergy(energy / 30));
  }
  const lraValues = shortTerms.filter((value) => value >= -70 && value >= integrated - 20);
  const lra = lraValues.length > 1 ? percentile(lraValues, 0.95) - percentile(lraValues, 0.10) : 0;

  let reconstructedPeak = samplePeak;
  const threshold = samplePeak * 0.45;
  const sourceFrames = wav.frameCount;
  for (let frame = 1; frame < sourceFrames - 2; frame += 1) {
    if (signal.aborted) throw new DOMException("Analisi annullata", "AbortError");
    for (let channel = 0; channel < wav.channels; channel += 1) {
      const b = wav.sample(frame, channel); const c = wav.sample(frame + 1, channel);
      if (Math.max(Math.abs(b), Math.abs(c)) < threshold) continue;
      const a = wav.sample(frame - 1, channel); const d = wav.sample(frame + 2, channel);
      reconstructedPeak = Math.max(reconstructedPeak, Math.abs(cubic(a, b, c, d, 0.25)), Math.abs(cubic(a, b, c, d, 0.5)), Math.abs(cubic(a, b, c, d, 0.75)));
    }
    if (frame % Math.max(1, Math.floor(sourceFrames / 80)) === 0) { onProgress(0.82 + frame / sourceFrames * 0.18, waveform); await nextPaint(); }
  }
  onProgress(1, waveform);
  return {
    integrated,
    lra,
    truePeak: reconstructedPeak > 0 ? 20 * Math.log10(reconstructedPeak) : -Infinity,
    samplePeak: samplePeak > 0 ? 20 * Math.log10(samplePeak) : -Infinity,
    waveform,
    sampleRate: wav.sampleRate,
    channels: wav.channels,
    bitsPerSample: wav.bitsPerSample,
    duration: wav.duration
  };
}

function writeAscii(view, offset, value) { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); }

export async function normalizeWav(wav, analysis, onProgress = () => {}, signal = { aborted: false }) {
  const frameCount = Math.floor(wav.duration * TARGET_RATE);
  const bytesPerFrame = wav.channels * 3;
  const dataBytes = frameCount * bytesPerFrame;
  if (dataBytes + 44 > 0xffffffff) throw new Error("Il WAV supera il limite RIFF di 4 GB: serve esportazione RF64");
  const header = new ArrayBuffer(44); const headerView = new DataView(header);
  writeAscii(headerView, 0, "RIFF"); headerView.setUint32(4, 36 + dataBytes, true); writeAscii(headerView, 8, "WAVE"); writeAscii(headerView, 12, "fmt ");
  headerView.setUint32(16, 16, true); headerView.setUint16(20, 1, true); headerView.setUint16(22, wav.channels, true); headerView.setUint32(24, TARGET_RATE, true);
  headerView.setUint32(28, TARGET_RATE * bytesPerFrame, true); headerView.setUint16(32, bytesPerFrame, true); headerView.setUint16(34, 24, true); writeAscii(headerView, 36, "data"); headerView.setUint32(40, dataBytes, true);
  const chunks = [header];
  const framesPerChunk = Math.max(1, Math.floor((1024 * 1024) / bytesPerFrame));
  const targetGainDb = TARGET_LUFS - analysis.integrated;
  const gain = 10 ** (targetGainDb / 20);
  // A small safety margin protects the reconstructed peak after 24-bit quantisation.
  const ceiling = 10 ** ((TRUE_PEAK_LIMIT - 0.2) / 20);
  const knee = ceiling * 0.86;
  let limitedSamples = 0;
  for (let start = 0; start < frameCount; start += framesPerChunk) {
    if (signal.aborted) throw new DOMException("Normalizzazione annullata", "AbortError");
    const count = Math.min(framesPerChunk, frameCount - start);
    const chunk = new Uint8Array(count * bytesPerFrame); const out = new DataView(chunk.buffer);
    let position = 0;
    for (let local = 0; local < count; local += 1) {
      const frame = start + local;
      for (let channel = 0; channel < wav.channels; channel += 1) {
        let value = interpolatedSample(wav, frame, channel) * gain;
        const magnitude = Math.abs(value);
        if (magnitude > knee) {
          limitedSamples += 1;
          const normalized = (magnitude - knee) / Math.max(1e-9, ceiling - knee);
          value = Math.sign(value) * (knee + (ceiling - knee) * (1 - Math.exp(-normalized)) / (1 - Math.exp(-1)));
        }
        value = Math.max(-ceiling, Math.min(ceiling, value));
        const quantized = Math.max(-8388608, Math.min(8388607, Math.round(value * 8388607)));
        out.setUint8(position, quantized & 0xff); out.setUint8(position + 1, (quantized >> 8) & 0xff); out.setUint8(position + 2, (quantized >> 16) & 0xff); position += 3;
      }
    }
    chunks.push(chunk); onProgress(Math.min(1, (start + count) / frameCount)); await nextPaint();
  }
  return { blob: new Blob(chunks, { type: "audio/wav" }), gainDb: targetGainDb, limitedRatio: limitedSamples / Math.max(1, frameCount * wav.channels) };
}

export const loudnessLimits = { TARGET_LUFS, TRUE_PEAK_LIMIT };
