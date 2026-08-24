import { dataUrl } from "./paths.js";

let fleet = null;

export async function loadFleet() {
  if (fleet) return fleet;
  const res = await fetch(dataUrl("fleet.json"));
  if (!res.ok) throw new Error("Could not load fleet data");
  fleet = await res.json();
  return fleet;
}

export function allPlanes() {
  return fleet ? fleet.planes : [];
}

export function planeById(id) {
  return allPlanes().find((item) => item.id === id) || allPlanes()[5] || allPlanes()[0];
}

export function cabinLabel(ac) {
  const loud =
    ac.cabin >= 0.75 ? "very loud" :
    ac.cabin >= 0.55 ? "loud" :
    ac.cabin >= 0.35 ? "moderate" :
    ac.cabin >= 0.2 ? "quiet" : "hushed";
  const kind = ac.kind === "piston" ? "radial rumble" : ac.kind === "prop" ? "prop drone" : "jet rumble";
  return loud + " " + kind;
}

export function grainLabel(ac) {
  if (ac.grainSteps <= 40) return "extreme";
  if (ac.grainSteps <= 100) return "heavy";
  if (ac.grainSteps <= 180) return "medium";
  if (ac.grainSteps <= 280) return "light";
  if (ac.grainSteps <= 420) return "clean";
  return "almost none";
}

export function skipLabel(ac) {
  if (ac.skipChance >= 0.7) return "constant";
  if (ac.skipChance >= 0.45) return "common";
  if (ac.skipChance >= 0.28) return "occasional";
  return "rare";
}

export function makers() {
  return [...new Set(allPlanes().map((item) => item.maker))];
}
