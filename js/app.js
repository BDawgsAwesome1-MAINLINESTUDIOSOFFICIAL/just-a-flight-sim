import { loadFleet, planeById, allPlanes, cabinLabel, grainLabel, skipLabel } from "./fleet-data.js";
import { ensureContext, playChime, playFart, playHangup } from "./audio.js";
import { assembleAnnouncement, decodeBlob, encodeWavAsync } from "./pa.js";

const talkBtn = document.getElementById("talk");
const previewBtn = document.getElementById("preview");
const exportBtn = document.getElementById("export");
const statusEl = document.getElementById("status");
const timerEl = document.getElementById("timer");
const meterFill = document.getElementById("meter-fill");
const noteEl = document.getElementById("note");
const aircraftEl = document.getElementById("aircraft");
const acMetaEl = document.getElementById("ac-meta");
const dossierEl = document.getElementById("dossier");
const forceToneEl = document.getElementById("force-tone");
const shareBtn = document.getElementById("share");
const importEl = document.getElementById("import");
const jumpsEl = document.getElementById("jumps");
const dropEl = document.getElementById("drop");

let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let processedBlob = null;
let previewAudio = null;
let recStart = 0;
let timerId = 0;
let meterId = 0;
let analyser = null;
let meterSource = null;
let recording = false;
let lastProcessedKey = "";
let lastHadTone = false;

function currentPlane() {
  return planeById(aircraftEl.value);
}

function setOff(btn, off) {
  btn.classList.toggle("is-off", off);
  btn.setAttribute("aria-disabled", off ? "true" : "false");
}

function isOff(btn) {
  return btn.classList.contains("is-off");
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setNote(text, isError) {
  noteEl.textContent = text;
  noteEl.classList.toggle("error", Boolean(isError));
}

function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return m + ":" + s;
}

function persist() {
  localStorage.setItem("jafs-aircraft", aircraftEl.value);
  localStorage.setItem("jafs-force-tone", forceToneEl.checked ? "1" : "0");
}

function shareUrl() {
  const url = new URL(location.href);
  url.searchParams.set("ac", currentPlane().id);
  return url.toString();
}

function fillAircraftSelect() {
  const groups = {};
  allPlanes().forEach((item) => {
    if (!groups[item.maker]) {
      const og = document.createElement("optgroup");
      og.label = item.maker;
      aircraftEl.appendChild(og);
      groups[item.maker] = og;
    }
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.name;
    groups[item.maker].appendChild(opt);
  });
}

function dossierHtml(ac) {
  const d = ac.dossier;
  if (!d) return "";
  return (
    '<div class="dossier-top">' +
      '<span class="dossier-k">PA verdict</span>' +
      '<span class="dossier-grade ' + d.key + '">' + d.grade + "</span>" +
    "</div>" +
    '<dl class="dossier-grid">' +
      "<dt>Year</dt><dd>" + d.year + " · " + d.body + "</dd>" +
      "<dt>System</dt><dd>" + d.system + "</dd>" +
      "<dt>Band</dt><dd>" + Math.round(ac.hp) + "–" + Math.round(ac.lp) + " Hz speech band</dd>" +
      "<dt>Grain</dt><dd>" + grainLabel(ac) + " · skips " + skipLabel(ac) + "</dd>" +
      "<dt>Cabin</dt><dd>" + cabinLabel(ac) + "</dd>" +
    "</dl>" +
    "<p><b>Good.</b> " + d.good + "</p>" +
    "<p><b>Bad.</b> " + d.bad + "</p>" +
    "<p><b>More.</b> " + d.more + "</p>"
  );
}

function updateAircraftMeta() {
  const ac = currentPlane();
  acMetaEl.textContent = ac.blurb;
  dossierEl.innerHTML = dossierHtml(ac);
  history.replaceState(null, "", "?ac=" + encodeURIComponent(ac.id));
  persist();
  if (jumpsEl) {
    jumpsEl.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("is-on", btn.dataset.id === ac.id);
    });
  }
}

function pickMime() {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus"
  ];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function startMeter(stream) {
  const ctx = ensureContext();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  meterSource = ctx.createMediaStreamSource(stream);
  meterSource.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      peak = Math.max(peak, Math.abs(data[i] - 128));
    }
    meterFill.style.width = Math.min(100, peak * 1.8) + "%";
    meterId = requestAnimationFrame(tick);
  };
  tick();
}

function stopMeter() {
  cancelAnimationFrame(meterId);
  meterFill.style.width = "0%";
  try { meterSource && meterSource.disconnect(); } catch (_) {}
  meterSource = null;
  analyser = null;
}

function startTimer() {
  recStart = performance.now();
  timerEl.textContent = "00:00";
  timerId = setInterval(() => {
    timerEl.textContent = formatTime(performance.now() - recStart);
  }, 200);
}

function stopTimer() {
  clearInterval(timerId);
}

function stopPreview() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio = null;
  }
}

function enableMixButtons() {
  setOff(previewBtn, false);
  setOff(exportBtn, false);
}

function fillJumps() {
  if (!jumpsEl) return;
  const ids = ["dc-3", "md-80", "q400", "737-800", "797-nma", "a350-900"];
  jumpsEl.innerHTML = ids.map((id) => {
    const ac = planeById(id);
    return '<button type="button" data-id="' + ac.id + '">' + ac.name + "</button>";
  }).join("");
}

async function useBlob(blob, note) {
  recordedBlob = blob;
  processedBlob = null;
  lastProcessedKey = "";
  enableMixButtons();
  setStatus("Recorded");
  setNote(note);
}

async function startAnnouncement() {
  recordedChunks = [];
  recordedBlob = null;
  processedBlob = null;
  lastProcessedKey = "";
  stopPreview();
  setOff(previewBtn, true);
  setOff(exportBtn, true);
  setOff(talkBtn, true);
  setNote("Requesting microphone…");

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch (err) {
    setOff(talkBtn, false);
    setStatus("Ready");
    setNote("Microphone access is required to record.", true);
    return;
  }

  const mime = pickMime();
  mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size) recordedChunks.push(event.data);
  };
  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach((track) => track.stop());
    recordedBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
    recording = false;
    setOff(talkBtn, false);
    talkBtn.classList.remove("live");
    talkBtn.textContent = "Begin Announcement";
    enableMixButtons();
    stopMeter();
    stopTimer();
    setStatus("Recorded");
    setNote("Recorded. Preview or export through the selected " + currentPlane().name + " PA.");
  };

  try {
    await playChime();
  } catch (err) {
    stream.getTracks().forEach((track) => track.stop());
    setOff(talkBtn, false);
    setNote("Could not play the PA chime.", true);
    return;
  }

  mediaRecorder.start();
  recording = true;
  startMeter(stream);
  startTimer();
  setOff(talkBtn, false);
  talkBtn.classList.add("live");
  talkBtn.textContent = "End Transmission";
  setStatus("Live");
  setNote("Recording. Speak after the chime.");
}

function stopAnnouncement() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;
  setOff(talkBtn, true);
  setStatus("Stopping");
  playHangup();
  mediaRecorder.stop();
}

function processKey() {
  return currentPlane().id + ":" + (forceToneEl.checked ? "1" : "0");
}

async function getProcessedBlob() {
  const key = processKey();
  if (processedBlob && lastProcessedKey === key) return processedBlob;
  if (!recordedBlob) throw new Error("No recording");
  setStatus("Processing");
  const voice = await decodeBlob(recordedBlob, ensureContext());
  const mixed = await assembleAnnouncement(voice, currentPlane(), forceToneEl.checked);
  lastHadTone = mixed.hadTone;
  processedBlob = await encodeWavAsync(mixed.buffer);
  lastProcessedKey = key;
  return processedBlob;
}

function stamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    "-" +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

async function previewMix() {
  setOff(previewBtn, true);
  try {
    const blob = await getProcessedBlob();
    stopPreview();
    previewAudio = new Audio(URL.createObjectURL(blob));
    previewAudio.onended = () => {
      setOff(previewBtn, false);
      setStatus("Recorded");
      setNote("Handset back on the hook.");
    };
    await previewAudio.play();
    setStatus("Preview");
    setNote(
      "Playing the " + currentPlane().name + " mix with cabin rumble. Hang-up is at the end." +
      (lastHadTone ? " A faint high tone is in this take." : "")
    );
  } catch (err) {
    setOff(previewBtn, false);
    setStatus("Recorded");
    setNote("Could not build the preview.", true);
  }
}

async function exportMix() {
  setOff(exportBtn, true);
  try {
    const blob = await getProcessedBlob();
    playHangup();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pa-" + currentPlane().id + "-" + stamp() + ".wav";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setStatus("Exported");
    setNote(
      "Saved a " + currentPlane().name + " mix with cabin rumble and hang-up." +
      (lastHadTone ? " A faint high tone crept into this take." : "")
    );
  } catch (err) {
    setNote("Could not export the announcement.", true);
  } finally {
    setOff(exportBtn, false);
    if (recordedBlob) setStatus(statusEl.textContent === "Exported" ? "Exported" : "Recorded");
  }
}

async function importFile(file) {
  if (!file) return;
  await useBlob(file, "Loaded " + file.name + ". Preview through the " + currentPlane().name + " PA.");
}

talkBtn.addEventListener("click", () => {
  if (isOff(talkBtn)) {
    playFart();
    return;
  }
  if (recording) stopAnnouncement();
  else startAnnouncement();
});
previewBtn.addEventListener("click", () => {
  if (isOff(previewBtn)) {
    playFart();
    return;
  }
  previewMix();
});
exportBtn.addEventListener("click", () => {
  if (isOff(exportBtn)) {
    playFart();
    return;
  }
  exportMix();
});
aircraftEl.addEventListener("change", () => {
  processedBlob = null;
  lastProcessedKey = "";
  updateAircraftMeta();
  stopPreview();
  if (recordedBlob) {
    setOff(previewBtn, false);
    setNote("Aircraft set to " + currentPlane().name + ". Preview to hear this PA over cabin rumble.");
  }
});
forceToneEl.addEventListener("change", () => {
  processedBlob = null;
  lastProcessedKey = "";
  persist();
  if (recordedBlob) {
    setNote(
      forceToneEl.checked
        ? "High PA tone forced on. Preview or export to hear it."
        : "High PA tone is random again (about 15%). Preview or export to rebuild."
    );
  }
});
shareBtn.addEventListener("click", async () => {
  const url = shareUrl();
  try {
    await navigator.clipboard.writeText(url);
    setNote("Copied link for the " + currentPlane().name + ".");
  } catch (_) {
    setNote(url);
  }
});
importEl.addEventListener("change", () => {
  const file = importEl.files && importEl.files[0];
  importFile(file);
  importEl.value = "";
});
if (jumpsEl) {
  jumpsEl.addEventListener("click", (event) => {
    const btn = event.target.closest("button");
    if (!btn) return;
    aircraftEl.value = btn.dataset.id;
    aircraftEl.dispatchEvent(new Event("change"));
  });
}

["dragenter", "dragover"].forEach((name) => {
  dropEl.addEventListener(name, (event) => {
    event.preventDefault();
    dropEl.classList.add("is-over");
  });
});
["dragleave", "drop"].forEach((name) => {
  dropEl.addEventListener(name, (event) => {
    event.preventDefault();
    dropEl.classList.remove("is-over");
  });
});
dropEl.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (file && file.type.startsWith("audio")) importFile(file);
});

window.addEventListener("keydown", (event) => {
  const tag = (event.target && event.target.tagName) || "";
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.code === "Space") {
    event.preventDefault();
    talkBtn.click();
  } else if (event.key === "p" || event.key === "P") {
    previewBtn.click();
  } else if (event.key === "e" || event.key === "E") {
    exportBtn.click();
  } else if (event.key === "l" || event.key === "L") {
    shareBtn.click();
  }
});

async function boot() {
  await loadFleet();
  fillAircraftSelect();
  forceToneEl.checked = localStorage.getItem("jafs-force-tone") === "1";
  const fromUrl = new URLSearchParams(location.search).get("ac");
  const saved = localStorage.getItem("jafs-aircraft");
  const pick = planeById(fromUrl || saved || "737-800");
  aircraftEl.value = pick.id;
  fillJumps();
  updateAircraftMeta();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

boot().catch(() => {
  setNote("Could not load the fleet file. Check the network and refresh.", true);
});
