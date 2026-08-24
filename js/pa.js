import { connectCabinGraph, loadCabin, loadChime, loadHangup } from "./audio.js";

export function bufferDuration(buffer) {
  return buffer.length / buffer.sampleRate;
}

export async function decodeBlob(blob, ctx) {
  const data = await blob.arrayBuffer();
  return ctx.decodeAudioData(data.slice(0));
}

function distortionCurve(amount) {
  const samples = 2048;
  const curve = new Float32Array(samples);
  const k = amount;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

function makeNoiseBuffer(ctx, length) {
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = last * 0.86 + white * 0.14;
    data[i] = last * 0.7 + white * 0.08;
  }
  return buffer;
}

function addGrain(channel, ac) {
  const steps = ac.grainSteps;
  const clip = ac.clip;
  for (let i = 0; i < channel.length; i++) {
    const hiss = (Math.random() * 2 - 1) * ac.hiss;
    let sample = channel[i] + hiss;
    sample = Math.round(sample * steps) / steps;
    if (sample > clip) sample = clip;
    if (sample < -clip) sample = -clip;
    channel[i] = sample;
  }
}

function applyDeadSpots(channel, sampleRate, ac) {
  if (Math.random() > ac.skipChance) return 0;
  const lo = ac.skipCount[0];
  const hi = ac.skipCount[1];
  const count = lo + Math.floor(Math.random() * (hi - lo + 1));
  if (count <= 0) return 0;
  const fade = Math.max(32, Math.round(sampleRate * 0.005));
  for (let n = 0; n < count; n++) {
    const dur = ac.skipMin + Math.random() * (ac.skipMax - ac.skipMin);
    const len = Math.max(fade * 2, Math.round(dur * sampleRate));
    if (len >= channel.length - fade) continue;
    const start = Math.floor(Math.random() * (channel.length - len));
    for (let i = 0; i < len; i++) {
      let env = 0;
      if (i < fade) env = 1 - i / fade;
      else if (i > len - fade) env = (len - i) / fade;
      channel[start + i] *= env * env;
    }
  }
  return count;
}

export async function applyPaTreatment(voiceBuffer, ac, forceTone) {
  const sampleRate = 48000;
  const length = Math.ceil(bufferDuration(voiceBuffer) * sampleRate);
  const ctx = new OfflineAudioContext(1, Math.max(1, length), sampleRate);

  const source = ctx.createBufferSource();
  source.buffer = voiceBuffer;

  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = ac.hp;
  highpass.Q.value = ac.hpQ;

  const presence = ctx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = ac.presence;
  presence.Q.value = ac.presenceQ;
  presence.gain.value = ac.presenceGain;

  const shaper = ctx.createWaveShaper();
  shaper.curve = distortionCurve(ac.drive);
  shaper.oversample = "2x";

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = ac.lp;
  lowpass.Q.value = ac.lpQ;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = ac.compThresh;
  compressor.knee.value = 10;
  compressor.ratio.value = ac.compRatio;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.16;

  const delay = ctx.createDelay(0.2);
  delay.delayTime.value = ac.delay;
  const delayGain = ctx.createGain();
  delayGain.gain.value = ac.reverb;
  const delayFilter = ctx.createBiquadFilter();
  delayFilter.type = "lowpass";
  delayFilter.frequency.value = Math.min(2400, ac.lp * 0.7);

  const voiceGain = ctx.createGain();
  voiceGain.gain.value = ac.gain;

  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(ctx, Math.max(1, length));
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.value = ac.noiseFreq;
  noiseFilter.Q.value = 0.6;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = ac.noise;

  source.connect(highpass);
  highpass.connect(presence);
  presence.connect(shaper);
  shaper.connect(lowpass);
  lowpass.connect(compressor);
  compressor.connect(voiceGain);
  voiceGain.connect(ctx.destination);

  voiceGain.connect(delay);
  delay.connect(delayFilter);
  delayFilter.connect(delayGain);
  delayGain.connect(ctx.destination);
  delayGain.connect(delay);

  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(lowpass);

  const hadTone = forceTone || Math.random() < 0.15;
  if (hadTone) {
    const tone = ctx.createOscillator();
    tone.type = "sine";
    tone.frequency.value = Math.min(3480, ac.lp * 0.9);
    const toneGain = ctx.createGain();
    toneGain.gain.value = 0.02;
    tone.connect(toneGain);
    toneGain.connect(lowpass);
    tone.start();
  }

  source.start();
  noise.start();

  const rendered = await ctx.startRendering();
  addGrain(rendered.getChannelData(0), ac);
  applyDeadSpots(rendered.getChannelData(0), sampleRate, ac);
  return { buffer: rendered, hadTone };
}

export async function assembleAnnouncement(voiceBuffer, ac, forceTone) {
  const ding = await loadChime();
  const treated = await applyPaTreatment(voiceBuffer, ac, forceTone);
  await loadCabin(ac.kind);
  const hang = await loadHangup();
  const sampleRate = 48000;
  const dingDur = bufferDuration(ding);
  const hangDur = bufferDuration(hang);
  const hangGap = 0.2;
  const dingLen = Math.ceil(dingDur * sampleRate);
  const voiceLen = treated.buffer.length;
  const gap = Math.round(sampleRate * 0.12);
  const hangGapLen = Math.round(sampleRate * hangGap);
  const hangLen = Math.ceil(hangDur * sampleRate);
  const paLen = dingLen + gap + voiceLen;
  const total = paLen + hangGapLen + hangLen;
  const paSecs = paLen / sampleRate;
  const out = new OfflineAudioContext(1, Math.max(1, total), sampleRate);

  const dingSource = out.createBufferSource();
  dingSource.buffer = ding;
  const dingGain = out.createGain();
  dingGain.gain.value = ac.dingGain;
  dingSource.connect(dingGain);
  dingGain.connect(out.destination);
  dingSource.start(0);

  const voiceSource = out.createBufferSource();
  voiceSource.buffer = treated.buffer;
  voiceSource.connect(out.destination);
  voiceSource.start(dingDur + 0.12);

  connectCabinGraph(out, out.destination, paSecs, ac);

  const hangSource = out.createBufferSource();
  hangSource.buffer = hang;
  hangSource.connect(out.destination);
  hangSource.start(paSecs + hangGap);

  const mixed = await out.startRendering();
  return { buffer: mixed, hadTone: treated.hadTone };
}

export function encodeWav(buffer) {
  const samples = buffer.getChannelData(0);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = pcm.length * 2;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, bytes, true);
  return new Blob([header, pcm.buffer], { type: "audio/wav" });
}

let worker = null;

export function encodeWavAsync(buffer) {
  const samples = buffer.getChannelData(0).slice();
  const sampleRate = buffer.sampleRate;
  return new Promise((resolve) => {
    const fallback = () => resolve(encodeWav(buffer));
    try {
      if (!worker) worker = new Worker(new URL("./encode-worker.js", import.meta.url));
      const onMsg = (event) => {
        worker.removeEventListener("message", onMsg);
        worker.removeEventListener("error", onErr);
        resolve(event.data);
      };
      const onErr = () => {
        worker.removeEventListener("message", onMsg);
        worker.removeEventListener("error", onErr);
        fallback();
      };
      worker.addEventListener("message", onMsg);
      worker.addEventListener("error", onErr);
      worker.postMessage({ sampleRate, samples }, [samples.buffer]);
    } catch (err) {
      fallback();
    }
  });
}
