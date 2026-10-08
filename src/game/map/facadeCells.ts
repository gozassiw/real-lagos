// Facade atlas layout shared by the main thread and the chunk worker (no three.js import here).
export const ATLAS_CELLS = 8; // 8 x 8 cells

/** cell indices (row-major); ground-floor and upper-floor cells per archetype & variant */
export const FACADE: Record<number, { ground: number[]; upper: number[] }> = {
  0: { ground: [0, 16], upper: [8, 8] }, // bungalow
  1: { ground: [1, 17], upper: [9, 25] }, // house (storey building)
  2: { ground: [2, 3, 18], upper: [10, 21, 9] }, // shophouse
  3: { ground: [19, 1], upper: [11, 23] }, // apartment block
  4: { ground: [4, 20], upper: [12, 15, 28, 29] }, // office / glass tower
  5: { ground: [5], upper: [13] }, // villa / duplex
  6: { ground: [6], upper: [14] }, // warehouse
  7: { ground: [7, 22], upper: [14] }, // market stall / kiosk
  8: { ground: [24], upper: [26] }, // church / mosque
  9: { ground: [27, 19], upper: [30, 11] }, // civic / school / hospital
};


/** Lagos-ish plaster colours (walls are tinted by these) */
export const WALL_TINTS = [
  '#efe6d2', '#e8d8b0', '#e9cf8c', '#e7b996', '#d9e2e6', '#bcd3e0', '#c7d9b4', '#f2efe8', '#e6c9c0', '#d8cfc2', '#f0e0b8', '#cfe0d6',
];
/** long-span aluminium / zinc roof colours */
export const ROOF_TINTS_ZINC = ['#a4472f', '#7a4c3a', '#3f6d92', '#56804c', '#8a5c3a', '#8e9196', '#a65a3f', '#6a6f75'];
