// Provenance: transplanted (lift, no logic change) from void news
// frontend/app/lib/biasColors.ts at 095846835a42205d3343292c75e67cad81d328a8
// (github.com/aacrit/void--news): LEAN_BASELINES, leanToBucket,
// LEAN_LABEL_TEXT and LEAN_ABBR. void news's ladder is the only ladder: rung
// labels are derived from these tables, never retyped elsewhere. Plain .mjs
// so the build-time normaliser (Node) and the page (TypeScript, via
// ladder.d.mts) share one copy. Re-lift if void news changes its ladder.

/** The seven outlet baselines, far left first. */
export const LEAN_BASELINES = [
  ["far-left", 10], ["left", 20], ["center-left", 35], ["center", 50],
  ["center-right", 65], ["right", 80], ["far-right", 90],
];

/** A score belongs to the baseline it is nearest; a tie takes the rung nearer the centre. */
export function leanToBucket(v) {
  let best = "center";
  let bestGap = Infinity;
  let bestPull = Infinity;
  for (const [name, base] of LEAN_BASELINES) {
    const gap = Math.abs(v - base);
    const pull = Math.abs(base - 50); // how extreme this rung is
    if (gap < bestGap - 1e-9 || (Math.abs(gap - bestGap) < 1e-9 && pull < bestPull)) {
      best = name;
      bestGap = gap;
      bestPull = pull;
    }
  }
  return best;
}

export const LEAN_LABEL_TEXT = {
  "far-left": "Far Left",
  left: "Left",
  "center-left": "Center-Left",
  center: "Center",
  "center-right": "Center-Right",
  right: "Right",
  "far-right": "Far Right",
};

/** The label and the bucket can never disagree: one derives from the other. */
export function leanLabel(v) {
  return LEAN_LABEL_TEXT[leanToBucket(v)];
}

export const LEAN_ABBR = {
  "far-left": "FL", left: "L", "center-left": "CL", center: "C",
  "center-right": "CR", right: "R", "far-right": "FR",
};
