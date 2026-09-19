#!/usr/bin/env bun
/**
 * Live eval for the deploy-diagnosis fallback question set.
 *
 * Reads eval/cases.jsonl, asks decide() one case at a time (sequential —
 * avoids rate spikes and keeps per-case latency honest), scores predicted
 * vs expected, exits 1 when the gate fails.
 *
 * Needs TYPESAFE_API_KEY. `--dry-run` scores expected-vs-expected to
 * validate the case file and scoring without spending API calls.
 *
 * Usage: bun eval/run.ts [--cases=path] [--threshold=0.7]
 *          [--min-known=0.8] [--min-fault=0.8] [--dry-run]
 */

import { decide, decisionConfig } from "../decision.ts";
import {
  buildState,
  DEPLOY_QUESTIONS,
  KNOWN_THRESHOLD,
  type Fault,
} from "./questions.ts";
import { gate, scoreCases, toResult, type CaseResult, type EvalCase } from "./score.ts";

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}
const dryRunOnly = process.argv.includes("--dry-run");

async function loadCases(path: string): Promise<EvalCase[]> {
  const text = await Bun.file(path).text();
  const cases: EvalCase[] = [];
  for (const [n, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`eval: ${path}:${n + 1}: not JSON`);
    }
    const c = raw as Record<string, unknown>;
    const expected = c.expected as { known?: unknown; fault?: unknown } | undefined;
    if (
      typeof c.id !== "string" ||
      (c.phase !== "build" && c.phase !== "crash") ||
      typeof c.arm_host !== "boolean" ||
      typeof c.log !== "string" ||
      typeof expected?.known !== "boolean" ||
      (expected.fault !== "platform" && expected.fault !== "repo" && expected.fault !== "unknown")
    ) {
      throw new Error(`eval: ${path}:${n + 1}: bad case shape (need id/phase/arm_host/log/expected{known,fault})`);
    }
    cases.push({
      id: c.id,
      phase: c.phase,
      arm_host: c.arm_host,
      log: c.log,
      expected: { known: expected.known, fault: expected.fault as Fault },
    });
  }
  if (cases.length === 0) throw new Error(`eval: ${path}: no cases`);
  return cases;
}

/** Perfect predicted answers: validates file + scoring, spends nothing. */
function dryRun(cases: EvalCase[], threshold: number): CaseResult[] {
  return cases.map((c) =>
    toResult(
      c,
      {
        known: { type: "noul", noul: c.expected.known ? 1 : 0 },
        fault: { type: "choice", choice: c.expected.fault, probabilities: {}, confidence: 1 },
      },
      { threshold },
    ),
  );
}

const here = new URL(".", import.meta.url).pathname;
const casesPath = arg("cases", `${here}cases.jsonl`);
const threshold = Number(arg("threshold", String(KNOWN_THRESHOLD)));
const floors = { minKnownAccuracy: Number(arg("min-known", "0.8")), minFaultAccuracy: Number(arg("min-fault", "0.8")) };
if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("eval: --threshold must be 0..1");

const cases = await loadCases(casesPath);

let results: CaseResult[];
if (dryRunOnly) {
  results = dryRun(cases, threshold);
} else {
  const config = decisionConfig();
  results = [];
  for (const c of cases) {
    const start = Date.now();
    const result = await decide(
      { state: buildState(c.phase, c.arm_host, c.log), questions: DEPLOY_QUESTIONS },
      { config },
    );
    results.push(
      toResult(c, result.answers, { threshold, costUsd: result.usage.cost, latencyMs: Date.now() - start }),
    );
  }
}

const metrics = scoreCases(results);
for (const r of results) {
  const faultOk = !r.expected.known || r.fault === r.expected.fault;
  const mark = r.surfaced === r.expected.known && faultOk ? "ok" : "MISS";
  console.log(
    `${mark} ${r.id} known=${r.knownProb.toFixed(2)} fault=${r.fault}(${r.faultConfidence.toFixed(2)}) surfaced=${r.surfaced} expected=${r.expected.known ? "known" : "unknown"}/${r.expected.fault}`,
  );
}
console.log(JSON.stringify({ threshold, metrics }, null, 2));

const verdict = gate(metrics, floors);
if (!verdict.pass) {
  console.error(`eval: FAIL — ${verdict.reasons.join("; ")}`);
  process.exit(1);
}
console.log("eval: PASS");
