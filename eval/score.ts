/**
 * Offline scoring for the deploy-diagnosis eval: predicted vs expected over
 * golden cases. Pure functions, no network — covered by score.test.ts so
 * `bun test` stays offline. The live loop lives in run.ts.
 */

import type { Answer } from "../decision.ts";
import { faultConfidence, faultOf, isSurfaced, knownProb, type Fault } from "./questions.ts";

export interface Expected {
  known: boolean;
  fault: Fault;
}

export interface EvalCase {
  id: string;
  phase: "build" | "crash";
  arm_host: boolean;
  log: string;
  expected: Expected;
}

export interface CaseResult {
  id: string;
  knownProb: number;
  fault: Fault;
  faultConfidence: number;
  surfaced: boolean;
  expected: Expected;
  costUsd: number | null;
  latencyMs: number;
}

export interface EvalMetrics {
  total: number;
  /** P(known) >= threshold matches expected.known. */
  knownAccuracy: number;
  /** Argmax fault matches expected.fault, over expected-known cases only. */
  faultAccuracy: number;
  /** Fraction of expected-unknown cases that stayed unsurfaced. Must be 1. */
  neverInventRate: number;
  /** Fraction of expected-known cases that surfaced. */
  recallKnown: number;
  /** Fault accuracy over surfaced cases only (the dispatched subset). */
  selectiveFaultAccuracy: number;
  /** Fraction of cases surfaced. */
  coverage: number;
  inventions: number;
  misses: number;
  totalCostUsd: number;
}

export function toResult(
  c: EvalCase,
  answers: Record<string, Answer>,
  opts: { threshold: number; costUsd?: number | null; latencyMs?: number },
): CaseResult {
  return {
    id: c.id,
    knownProb: knownProb(answers),
    fault: faultOf(answers),
    faultConfidence: faultConfidence(answers),
    surfaced: isSurfaced(answers, opts.threshold),
    expected: c.expected,
    costUsd: opts.costUsd ?? null,
    latencyMs: opts.latencyMs ?? 0,
  };
}

function rate(n: number, d: number): number {
  return d === 0 ? 1 : n / d;
}

export function scoreCases(results: CaseResult[]): EvalMetrics {
  const knownCorrect = results.filter((r) => r.surfaced === r.expected.known).length;
  const faultCorrect = results.filter((r) => r.expected.known && r.fault === r.expected.fault).length;
  const unknown = results.filter((r) => !r.expected.known);
  const known = results.filter((r) => r.expected.known);
  const surfaced = results.filter((r) => r.surfaced);
  const inventions = unknown.filter((r) => r.surfaced).length;
  const misses = known.filter((r) => !r.surfaced).length;
  const selectiveCorrect = surfaced.filter((r) => r.fault === r.expected.fault).length;

  return {
    total: results.length,
    knownAccuracy: rate(knownCorrect, results.length),
    faultAccuracy: rate(faultCorrect, known.length),
    neverInventRate: rate(unknown.length - inventions, unknown.length),
    recallKnown: rate(known.length - misses, known.length),
    selectiveFaultAccuracy: rate(selectiveCorrect, surfaced.length),
    coverage: rate(surfaced.length, results.length),
    inventions,
    misses,
    totalCostUsd: results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
  };
}

export interface GateFloors {
  minKnownAccuracy: number;
  minFaultAccuracy: number;
}

/** Inventions are always fatal: a surfaced diagnosis on an unknown log is the failure mode. */
export function gate(metrics: EvalMetrics, floors: GateFloors): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (metrics.inventions > 0) reasons.push(`${metrics.inventions} invented diagnoses on unknown logs`);
  if (metrics.knownAccuracy < floors.minKnownAccuracy) {
    reasons.push(`known accuracy ${metrics.knownAccuracy.toFixed(2)} < ${floors.minKnownAccuracy}`);
  }
  if (metrics.faultAccuracy < floors.minFaultAccuracy) {
    reasons.push(`fault accuracy ${metrics.faultAccuracy.toFixed(2)} < ${floors.minFaultAccuracy}`);
  }
  return { pass: reasons.length === 0, reasons };
}
