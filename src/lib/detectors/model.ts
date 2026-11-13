import type { DustDetector } from "./types";

// Third-party model slot. Leave MODEL as null until a model is chosen; the dashboard then uses
// the on-device calculation. To plug one in, fill MODEL and implement `run` below, for example with
// Transformers.js or ONNX Runtime Web, so it stays free and runs in the browser.

export interface ModelConfig {
  /** Shown in the result, e.g. "SolarSoil-Seg (Hugging Face)". */
  name: string;
  /** Model id or URL of the weights. Prefer a copy served from /public so nothing is fetched at demo time. */
  source: string;
  /** Licence, so it is visible in code review (must allow commercial use). */
  license: string;
}

export const MODEL: ModelConfig | null = null;

/** Returns a detector for the configured model, or null when no model is provided. */
export function modelDetector(): DustDetector | null {
  if (!MODEL) return null;
  const config = MODEL;
  return {
    id: `model:${config.source}`,
    name: config.name,
    kind: "model",
    async prepare() {
      // Load and cache the weights here.
    },
    async detect() {
      // Run the model and map its output to DustResult:
      //  - segmentation mask → coveragePercent = dust pixels / surface pixels, overlay = mask drawn on the photo
      //  - classifier → details: [{ label: "Confidence", value }], coverage from the local calculation if needed
      throw new Error(`Model "${config.name}" is configured but not implemented yet.`);
    },
  };
}
