import { SOUNDS } from "./paths.js";

let audioCtx = null;
const buffers = {};

export function ensureContext() {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

export async function loadSound(key, url) {
  if (buffers[key]) return buffers[key];
  const ctx = ensureContext();
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  buffers[key] = await ctx.decodeAudioData(buf.slice(0));
  return buffers[key];
}

export async function playSound(key, url) {
  const ctx = ensureContext();
  if (ctx.state === "suspended") await ctx.resume();
  const buffer = await loadSound(key, url);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  return buffer.duration;
}

export function playChime() {
  return playSound("chime", SOUNDS.chime);
}

export function playFart() {
  return playSound("fart", SOUNDS.fart);
}

export function playHangup() {
  return playSound("hangup", SOUNDS.hangup);
}

export function loadChime() {
  return loadSound("chime", SOUNDS.chime);
}

export function loadHangup() {
  return loadSound("hangup", SOUNDS.hangup);
}

export function loadCabin(kind) {
  const file = SOUNDS.cabin[kind] || SOUNDS.cabin.jet;
  return loadSound("cabin-" + (kind || "jet"), file);
}

export function connectCabinGraph(ctx, dest, duration, ac) {
  const kind = ac.kind || "jet";
  const source = ctx.createBufferSource();
  source.buffer = buffers["cabin-" + kind] || buffers["cabin-jet"];
  source.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  const gain = ctx.createGain();
  if (kind === "piston") {
    hp.frequency.value = 40;
    lp.frequency.value = 1100;
    gain.gain.value = ac.cabin * 0.34;
  } else if (kind === "prop") {
    hp.frequency.value = 55;
    lp.frequency.value = 1700;
    gain.gain.value = ac.cabin * 0.3;
  } else {
    hp.frequency.value = 45;
    lp.frequency.value = 2600;
    gain.gain.value = ac.cabin * 0.24;
  }
  source.connect(hp);
  hp.connect(lp);
  if (kind === "prop" || kind === "piston") {
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = kind === "prop" ? 21 : 14.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = gain.gain.value * (kind === "prop" ? 0.22 : 0.3);
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    lfo.start();
    if (duration) lfo.stop(duration);
  }
  lp.connect(gain);
  gain.connect(dest);
  source.start();
  if (duration) source.stop(duration);
  return source;
}
