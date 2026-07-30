/**
 * Issue #33 — continuous analog process tags from the field simulator.
 *
 * Covers the issue's acceptance criteria: determinism for a fixed seed,
 * bounds (values stay within baseline ± (drift + noise)), numeric broadcast
 * values, cadence wiring via SIMULATOR_ANALOG_INTERVAL_MS, and that analog
 * emission respects SIMULATOR_ENABLED.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ANALOG_CHANNELS_BY_ASSET_TYPE,
  analogValue,
  seededUnitNoise,
} from "../simulator-analog";

const broadcastTagUpdate = vi.fn();

vi.mock("../websocket/tag-stream", () => ({
  tagStreamServer: { broadcastTagUpdate: (...args: unknown[]) => broadcastTagUpdate(...args) },
}));
vi.mock("../websocket/cached-event-bridge", () => ({
  cachedEventBridge: { publishAlarm: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../services/flux", () => ({
  getFluxPublisher: () => ({ publishAsset: vi.fn() }),
}));
vi.mock("../services/nats", () => ({
  natsPublisher: { publishScadaEvent: vi.fn() },
}));
vi.mock("../bridge", () => ({
  getAnchorPipeline: () => null,
}));
vi.mock("../logger", () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

describe("analog signal generator (pure)", () => {
  const allSpecs = Object.entries(ANALOG_CHANNELS_BY_ASSET_TYPE).flatMap(
    ([assetType, specs]) => specs.map((spec) => ({ assetType, spec }))
  );

  it("declares 1–3 channels for every simulated asset type", () => {
    for (const assetType of ["TRANSFORMER", "BREAKER", "INVERTER", "MCC"]) {
      const specs = ANALOG_CHANNELS_BY_ASSET_TYPE[assetType];
      expect(specs, assetType).toBeDefined();
      expect(specs.length).toBeGreaterThanOrEqual(1);
      expect(specs.length).toBeLessThanOrEqual(3);
    }
  });

  it("is deterministic: a fixed seed reproduces the exact series", () => {
    for (const { spec } of allSpecs) {
      const tag = `TR-MAIN-01.${spec.channel}`;
      const a = Array.from({ length: 50 }, (_, t) => analogValue(spec, tag, t, 42));
      const b = Array.from({ length: 50 }, (_, t) => analogValue(spec, tag, t, 42));
      expect(a).toEqual(b);
    }
  });

  it("a different seed produces a different series", () => {
    const spec = ANALOG_CHANNELS_BY_ASSET_TYPE.TRANSFORMER[0];
    const tag = `TR-MAIN-01.${spec.channel}`;
    const a = Array.from({ length: 50 }, (_, t) => analogValue(spec, tag, t, 1));
    const b = Array.from({ length: 50 }, (_, t) => analogValue(spec, tag, t, 2));
    expect(a).not.toEqual(b);
  });

  it("stays within baseline ± (drift + noise) and is always finite", () => {
    for (const { spec } of allSpecs) {
      const tag = `ASSET-X.${spec.channel}`;
      for (let t = 0; t < 1000; t++) {
        const v = analogValue(spec, tag, t, 7);
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v - spec.baseline)).toBeLessThanOrEqual(spec.drift + spec.noise);
      }
    }
  });

  it("different tags are decorrelated (distinct phase/noise)", () => {
    const spec = ANALOG_CHANNELS_BY_ASSET_TYPE.BREAKER[0];
    const a = Array.from({ length: 20 }, (_, t) => analogValue(spec, `BK-FEEDER-01.${spec.channel}`, t, 1));
    const b = Array.from({ length: 20 }, (_, t) => analogValue(spec, `BK-FEEDER-02.${spec.channel}`, t, 1));
    expect(a).not.toEqual(b);
  });

  it("noise draws land in [-1, 1)", () => {
    for (let t = 0; t < 1000; t++) {
      const n = seededUnitNoise(3, "TAG.CHANNEL", t);
      expect(n).toBeGreaterThanOrEqual(-1);
      expect(n).toBeLessThan(1);
    }
  });
});

describe("field simulator analog wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    broadcastTagUpdate.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  async function startSimulator() {
    const { fieldSimulator } = await import("../simulator");
    await fieldSimulator.initialize();
    fieldSimulator.start();
    return fieldSimulator;
  }

  it("broadcasts numeric analog tags on the configured cadence", async () => {
    vi.stubEnv("SIMULATOR_ENABLED", "true");
    vi.stubEnv("SIMULATOR_ANALOG_INTERVAL_MS", "2000");
    const sim = await startSimulator();

    expect(broadcastTagUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);

    // 6 demo assets: TRANSFORMER(2) + BREAKER(1) + INVERTER(2) + MCC(1) + BREAKER(1) + INVERTER(2) = 9 tags/tick
    expect(broadcastTagUpdate).toHaveBeenCalledTimes(9);
    for (const [update] of broadcastTagUpdate.mock.calls) {
      expect(update.tagName).toMatch(/^[A-Z0-9-]+\.[A-Z_]+$/);
      expect(typeof update.value).toBe("number");
      expect(Number.isFinite(update.value)).toBe(true);
      expect(update.quality).toBe("good");
      expect(typeof update.timestamp).toBe("string");
    }

    vi.advanceTimersByTime(2000);
    expect(broadcastTagUpdate).toHaveBeenCalledTimes(18);

    sim.stop();
    vi.advanceTimersByTime(10000);
    expect(broadcastTagUpdate).toHaveBeenCalledTimes(18);
  });

  it("emits the documented tag names for known assets", async () => {
    vi.stubEnv("SIMULATOR_ENABLED", "true");
    const sim = await startSimulator();
    vi.advanceTimersByTime(2000);

    const tags = broadcastTagUpdate.mock.calls.map(([u]) => u.tagName);
    expect(tags).toContain("TR-MAIN-01.TEMPERATURE");
    expect(tags).toContain("TR-MAIN-01.LOAD_PERCENT");
    expect(tags).toContain("BK-FEEDER-01.CURRENT");
    sim.stop();
  });

  it("respects SIMULATOR_ENABLED=false — no analog emission", async () => {
    vi.stubEnv("SIMULATOR_ENABLED", "false");
    const sim = await startSimulator();
    vi.advanceTimersByTime(30000);
    expect(broadcastTagUpdate).not.toHaveBeenCalled();
    sim.stop();
  });

  it("clamps a malformed SIMULATOR_ANALOG_INTERVAL_MS to the 2s default", async () => {
    vi.stubEnv("SIMULATOR_ENABLED", "true");
    vi.stubEnv("SIMULATOR_ANALOG_INTERVAL_MS", "banana");
    const sim = await startSimulator();
    vi.advanceTimersByTime(1999);
    expect(broadcastTagUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(broadcastTagUpdate).toHaveBeenCalledTimes(9);
    sim.stop();
  });
});
