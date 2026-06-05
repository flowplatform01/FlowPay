import { performance } from "node:perf_hooks";

export type TimingStep = {
  name: string;
  durationMs: number;
};

export class LatencyTimer {
  private readonly startedAt = performance.now();
  private lastMark = this.startedAt;
  private readonly steps: TimingStep[] = [];

  mark(name: string) {
    const now = performance.now();
    this.steps.push({
      name,
      durationMs: roundMs(now - this.lastMark)
    });
    this.lastMark = now;
  }

  snapshot() {
    return {
      totalMs: roundMs(performance.now() - this.startedAt),
      steps: this.steps
    };
  }
}

export function roundMs(value: number) {
  return Math.round(value * 100) / 100;
}
