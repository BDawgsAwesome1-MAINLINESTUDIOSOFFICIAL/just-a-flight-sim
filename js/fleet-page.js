import { loadFleet, allPlanes, planeById, cabinLabel, grainLabel, skipLabel } from "./fleet-data.js";

const searchEl = document.getElementById("search");
const makerEl = document.getElementById("maker");
const gradeEl = document.getElementById("grade");
const cardsEl = document.getElementById("cards");
const leftEl = document.getElementById("left");
const rightEl = document.getElementById("right");
const leftCard = document.getElementById("left-card");
const rightCard = document.getElementById("right-card");

function dossierHtml(ac) {
  const d = ac.dossier;
  if (!d) return "<p class='note'>No dossier.</p>";
  return (
    '<div class="dossier-top">' +
      '<span class="dossier-k">' + ac.name + "</span>" +
      '<span class="dossier-grade ' + d.key + '">' + d.grade + "</span>" +
    "</div>" +
    '<dl class="dossier-grid">' +
      "<dt>Year</dt><dd>" + d.year + " · " + d.body + "</dd>" +
      "<dt>System</dt><dd>" + d.system + "</dd>" +
      "<dt>Band</dt><dd>" + Math.round(ac.hp) + "–" + Math.round(ac.lp) + " Hz</dd>" +
      "<dt>Grain</dt><dd>" + grainLabel(ac) + " · skips " + skipLabel(ac) + "</dd>" +
      "<dt>Cabin</dt><dd>" + cabinLabel(ac) + "</dd>" +
    "</dl>" +
    "<p><b>Good.</b> " + d.good + "</p>" +
    "<p><b>Bad.</b> " + d.bad + "</p>"
  );
}

function fillSelect(el, selected) {
  el.innerHTML = allPlanes().map((item) =>
    '<option value="' + item.id + '"' + (item.id === selected ? " selected" : "") + ">" +
      item.maker + " " + item.name +
    "</option>"
  ).join("");
}

function renderCompare() {
  leftCard.innerHTML = dossierHtml(planeById(leftEl.value));
  rightCard.innerHTML = dossierHtml(planeById(rightEl.value));
  const url = new URL(location.href);
  url.searchParams.set("a", leftEl.value);
  url.searchParams.set("b", rightEl.value);
  history.replaceState(null, "", url);
}

function matches(ac) {
  const q = searchEl.value.trim().toLowerCase();
  const maker = makerEl.value;
  const grade = gradeEl.value;
  if (maker && ac.maker !== maker) return false;
  if (grade && (!ac.dossier || ac.dossier.key !== grade)) return false;
  if (!q) return true;
  const hay = [
    ac.id, ac.name, ac.maker, ac.blurb, cabinLabel(ac),
    ac.dossier && ac.dossier.grade,
    ac.dossier && ac.dossier.system,
    ac.dossier && ac.dossier.year
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
}

function renderCards() {
  const list = allPlanes().filter(matches);
  cardsEl.innerHTML = list.map((ac) => {
    const grade = ac.dossier ? ac.dossier.grade : "";
    const key = ac.dossier ? ac.dossier.key : "";
    return (
      '<a class="card" href="./index.html?ac=' + encodeURIComponent(ac.id) + '">' +
        '<div class="maker">' + ac.maker + '</div>' +
        '<div class="name">' + ac.name + '</div>' +
        '<div class="dossier-grade ' + key + '">' + grade + "</div>" +
        "<p>" + cabinLabel(ac) + " · " + grainLabel(ac) + " grain</p>" +
      "</a>"
    );
  }).join("") || '<p class="note">No types match.</p>';
}

function onFilter() {
  renderCards();
}

searchEl.addEventListener("input", onFilter);
makerEl.addEventListener("change", onFilter);
gradeEl.addEventListener("change", onFilter);
leftEl.addEventListener("change", renderCompare);
rightEl.addEventListener("change", renderCompare);

async function boot() {
  await loadFleet();
  const makers = [...new Set(allPlanes().map((item) => item.maker))];
  makers.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    makerEl.appendChild(opt);
  });
  const params = new URLSearchParams(location.search);
  fillSelect(leftEl, params.get("a") || "737-800");
  fillSelect(rightEl, params.get("b") || "797-nma");
  renderCompare();
  renderCards();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

boot();
