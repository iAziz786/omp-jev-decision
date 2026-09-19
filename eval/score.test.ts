import { describe, expect, test } from "bun:test";
import { gate, scoreCases, toResult, type CaseResult, type EvalCase } from "./score.ts";

const THRESHOLD = 0.7;

function knownCase(id: string, fault: "platform" | "repo" = "repo"): EvalCase {
  return { id, phase: "build", arm_host: false, log: "x", expected: { known: true, fault } };
}

function unknownCase(id: string): EvalCase {
  return { id, phase: "crash", arm_host: false, log: "x", expected: { known: false, fault: "unknown" } };
}

function result(c: EvalCase, known: number, fault: "platform" | "repo" | "unknown"): CaseResult {
  return toResult(
    c,
    {
      known: { type: "noul" as const, noul: known },
      fault: { type: "choice" as const, choice: fault, probabilities: {}, confidence: 0.9 },
    },
    { threshold: THRESHOLD },
  );
}

describe("scoreCases", () => {
  test("perfect predictions score 1.0 and pass the gate", () => {
    const results = [
      result(knownCase("k1"), 0.95, "repo"),
      result(knownCase("k2", "platform"), 0.8, "platform"),
      result(unknownCase("u1"), 0.1, "unknown"),
    ];
    const metrics = scoreCases(results);
    expect(metrics.total).toBe(3);
    expect(metrics.knownAccuracy).toBe(1);
    expect(metrics.faultAccuracy).toBe(1);
    expect(metrics.neverInventRate).toBe(1);
    expect(metrics.recallKnown).toBe(1);
    expect(gate(metrics, { minKnownAccuracy: 0.8, minFaultAccuracy: 0.8 }).pass).toBe(true);
  });

  test("a surfaced diagnosis on an unknown log fails the gate", () => {
    const results = [result(knownCase("k1"), 0.95, "repo"), result(unknownCase("u1"), 0.9, "repo")];
    const metrics = scoreCases(results);
    expect(metrics.inventions).toBe(1);
    expect(metrics.neverInventRate).toBe(0);
    const verdict = gate(metrics, { minKnownAccuracy: 0.8, minFaultAccuracy: 0.8 });
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons.join(" ")).toMatch(/invented/);
  });

  test("low confidence on a known case is a miss, not an invention", () => {
    const results = [result(knownCase("k1"), 0.4, "repo"), result(unknownCase("u1"), 0.1, "unknown")];
    const metrics = scoreCases(results);
    expect(metrics.misses).toBe(1);
    expect(metrics.inventions).toBe(0);
    expect(metrics.neverInventRate).toBe(1);
    expect(metrics.recallKnown).toBe(0);
  });

  test("wrong fault attribution lowers fault accuracy and selective accuracy", () => {
    const results = [
      result(knownCase("k1", "platform"), 0.9, "repo"),
      result(knownCase("k2"), 0.9, "repo"),
    ];
    const metrics = scoreCases(results);
    expect(metrics.faultAccuracy).toBe(0.5);
    expect(metrics.selectiveFaultAccuracy).toBe(0.5);
    expect(gate(metrics, { minKnownAccuracy: 0.8, minFaultAccuracy: 0.8 }).pass).toBe(false);
  });

  test("fault guesses on unknown logs do not lower fault accuracy", () => {
    const results = [result(unknownCase("u1"), 0.05, "repo"), result(knownCase("k1"), 0.95, "repo")];
    expect(scoreCases(results).faultAccuracy).toBe(1);
  });

  test("an unknown fault choice keeps the case unsurfaced", () => {
    const r = result(knownCase("k1"), 0.99, "unknown");
    expect(r.surfaced).toBe(false);
    expect(scoreCases([r]).coverage).toBe(0);
  });
});
