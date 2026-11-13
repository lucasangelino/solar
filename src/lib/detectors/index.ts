import { loadImage } from "@/lib/dust";
import { localDetector } from "./local";
import { modelDetector } from "./model";
import type { DetectionOutcome, DustDetector } from "./types";

export type { DetectionOutcome, DustDetail, DustDetector, DustResult } from "./types";

/** The model when one is provided, otherwise the on-device calculation. */
export function activeDetector(): DustDetector {
  return modelDetector() ?? localDetector;
}

const prepared = new WeakSet<DustDetector>();

/** Analyse a photo with the active detector. If a model fails, fall back to the local calculation. */
export async function detectDust(photo: string): Promise<DetectionOutcome> {
  const image = await loadImage(photo);
  const detector = activeDetector();
  try {
    if (detector.prepare && !prepared.has(detector)) {
      await detector.prepare();
      prepared.add(detector);
    }
    return { ...(await detector.detect(image)), detector: describe(detector) };
  } catch (error) {
    if (detector === localDetector) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    return { ...(await localDetector.detect(image)), detector: describe(localDetector), fallbackReason: reason };
  }
}

const describe = (d: DustDetector) => ({ id: d.id, name: d.name, kind: d.kind });
