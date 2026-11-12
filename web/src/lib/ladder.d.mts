export type LeanCategory = "far-left" | "left" | "center-left" | "center" | "center-right" | "right" | "far-right";
export const LEAN_BASELINES: ReadonlyArray<readonly [LeanCategory, number]>;
export function leanToBucket(v: number): LeanCategory;
export const LEAN_LABEL_TEXT: Record<LeanCategory, string>;
export function leanLabel(v: number): string;
export const LEAN_ABBR: Record<LeanCategory, string>;
