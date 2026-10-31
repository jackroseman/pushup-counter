/**
 * A recorded face-distance trace: [msSinceSetStart, distanceMeters | null] pairs.
 * null = face not tracked during that bucket. Stored with each set (~10 Hz).
 */
export type TracePoint = [number, number | null];

export interface TraceRecorderOptions {
  /** Bucket size in ms (100 ms = 10 Hz). */
  bucketMs: number;
  /** When exceeded, the trace is halved in resolution so very long sets stay small. */
  maxPoints: number;
}

export const DEFAULT_TRACE_OPTIONS: TraceRecorderOptions = { bucketMs: 100, maxPoints: 3000 };

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** Downsamples ~30 Hz face-distance samples into fixed-size buckets (mean of tracked samples). */
export class TraceRecorder {
  private points: TracePoint[] = [];
  private bucketMs: number;
  private bucket = -1;
  private sum = 0;
  private n = 0;

  constructor(
    private readonly startAt: number,
    private readonly options: TraceRecorderOptions = DEFAULT_TRACE_OPTIONS
  ) {
    this.bucketMs = options.bucketMs;
  }

  get resolutionMs(): number {
    return this.bucketMs;
  }

  add(distance: number | null, timestamp: number): void {
    const t = timestamp - this.startAt;
    if (t < 0) return;
    const b = Math.floor(t / this.bucketMs);
    if (b !== this.bucket) {
      this.flush();
      this.bucket = b;
    }
    if (distance !== null && Number.isFinite(distance) && distance > 0) {
      this.sum += distance;
      this.n += 1;
    }
  }

  /** Returns the trace so far (including the open bucket). */
  finish(): TracePoint[] {
    this.flush();
    return this.points.slice();
  }

  private flush(): void {
    if (this.bucket < 0) return;
    this.points.push([this.bucket * this.bucketMs, this.n ? round4(this.sum / this.n) : null]);
    this.bucket = -1;
    this.sum = 0;
    this.n = 0;
    if (this.points.length > this.options.maxPoints) this.decimate();
  }

  private decimate(): void {
    const out: TracePoint[] = [];
    for (let i = 0; i < this.points.length; i += 2) {
      const a = this.points[i];
      const b = this.points[i + 1];
      const vals = [a[1], b?.[1]].filter((v): v is number => v !== null && v !== undefined);
      out.push([a[0], vals.length ? round4(vals.reduce((x, y) => x + y, 0) / vals.length) : null]);
    }
    this.points = out;
    this.bucketMs *= 2;
  }
}
