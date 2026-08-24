export const audioUrl = (name) => new URL(`../audio/${name}`, import.meta.url).href;
export const dataUrl = (name) => new URL(`../data/${name}`, import.meta.url).href;

export const SOUNDS = {
  chime: audioUrl("chime.mp3"),
  fart: audioUrl("fart.mp3"),
  hangup: audioUrl("hangup.mp3"),
  cabin: {
    jet: audioUrl("cabin-jet.mp3"),
    prop: audioUrl("cabin-prop.mp3"),
    piston: audioUrl("cabin-piston.mp3")
  }
};
