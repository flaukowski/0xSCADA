/**
 * Continuous analog process signals for the field simulator (#33).
 *
 * Signal shape: baseline + slow sinusoidal drift + bounded noise. Every
 * value is a pure function of (spec, tagName, tick, seed) — there is no
 * Math.random and no hidden state in the signal path, so a fixed seed
 * reproduces the exact series and tests are deterministic.
 *
 * Guaranteed bound: |value − baseline| ≤ drift + noise (sin is ≤ 1 and the
 * noise term is drawn from [−1, 1)), and every value is a finite number.
 */

export interface AnalogChannelSpec {
  /** Channel suffix — broadcast as `${asset.nameOrTag}.${channel}` */
  channel: string;
  /** Center of the signal band, in engineering units */
  baseline: number;
  /** Peak amplitude of the slow sinusoidal drift */
  drift: number;
  /** Peak amplitude of the per-tick noise */
  noise: number;
  /** Drift period, in ticks */
  periodTicks: number;
}

/**
 * 1–3 plausible analog channels per simulated asset type. Units are implied
 * by the channel name (°C, %, A, kW); consumers only need numeric series.
 */
export const ANALOG_CHANNELS_BY_ASSET_TYPE: Record<string, AnalogChannelSpec[]> = {
  TRANSFORMER: [
    { channel: "TEMPERATURE", baseline: 65, drift: 8, noise: 1.5, periodTicks: 300 },
    { channel: "LOAD_PERCENT", baseline: 72, drift: 15, noise: 3, periodTicks: 450 },
  ],
  BREAKER: [
    { channel: "CURRENT", baseline: 850, drift: 120, noise: 25, periodTicks: 240 },
  ],
  INVERTER: [
    { channel: "OUTPUT_KW", baseline: 420, drift: 60, noise: 12, periodTicks: 360 },
    { channel: "DC_VOLTAGE", baseline: 780, drift: 20, noise: 5, periodTicks: 500 },
  ],
  MCC: [
    { channel: "MOTOR_CURRENT", baseline: 95, drift: 20, noise: 4, periodTicks: 270 },
  ],
};

/** FNV-1a 32-bit string hash — decorrelates tags into distinct phases/noise. */
export function hashTag(tag: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * One mulberry32 step keyed by (seed, tag, tick), mapped to [−1, 1).
 * Stateless: the same inputs always produce the same draw.
 */
export function seededUnitNoise(seed: number, tag: string, tick: number): number {
  let t = (seed ^ hashTag(tag) ^ Math.imul(tick + 1, 0x9e3779b9)) >>> 0;
  t = (t + 0x6d2b79f5) >>> 0;
  let x = Math.imul(t ^ (t >>> 15), t | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  const unit = ((x ^ (x >>> 14)) >>> 0) / 4294967296; // [0, 1)
  return unit * 2 - 1;
}

/**
 * The analog sample for a tag at a tick: baseline + drift·sin(...) + noise.
 * `tagName` should be the full broadcast tag (`ASSET.CHANNEL`) so different
 * assets sharing a channel spec do not move in lockstep.
 */
export function analogValue(
  spec: AnalogChannelSpec,
  tagName: string,
  tick: number,
  seed: number
): number {
  const phase = (hashTag(tagName) % 628) / 100; // [0, 2π), per-tag offset
  const drift = spec.drift * Math.sin((2 * Math.PI * tick) / spec.periodTicks + phase);
  const noise = spec.noise * seededUnitNoise(seed, tagName, tick);
  return spec.baseline + drift + noise;
}
