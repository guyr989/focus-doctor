export class Escalator {
  private lastLevel = 0;
  private lastFiredAt = -Infinity;
  private snoozedUntil = 0;

  constructor(private readonly opts: {thresholds: number[]; cooldownSeconds: number}) {}

  evaluate(driftSeconds: number, nowMs: number): number | null {
    if (driftSeconds <= 0) {
      this.reset();
      return null;
    }
    if (nowMs < this.snoozedUntil) return null;
    const level = this.opts.thresholds.filter(t => driftSeconds >= t).length;
    if (level === 0) return null;
    const cooledDown = nowMs - this.lastFiredAt >= this.opts.cooldownSeconds * 1000;
    if (level > this.lastLevel || (level === this.lastLevel && cooledDown)) {
      this.lastLevel = level;
      this.lastFiredAt = nowMs;
      return level;
    }
    return null;
  }

  snooze(untilMs: number): void {
    this.snoozedUntil = untilMs;
  }

  reset(): void {
    this.lastLevel = 0;
    this.lastFiredAt = -Infinity;
  }
}
