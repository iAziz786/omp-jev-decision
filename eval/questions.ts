/**
 * Shared Jev question set for the deploy-diagnosis fallback eval.
 *
 * Placement contract (selfhost): deterministic classifiers run first —
 * BuildFailureClassifier / DeployCrashClassifier — and Jev only sees the
 * `nil` branch. Surface a note only when `known` clears KNOWN_THRESHOLD
 * and `fault` is not `unknown`; anything else keeps the generic path.
 */

import type { Answer, JudgmentState, Questions } from "../decision.ts";

export type Fault = "platform" | "repo" | "unknown";

/** Surface Jev's note only at or above this P(known). Tune on fresh data. */
export const KNOWN_THRESHOLD = 0.7;

/** Keep logs short: Jev bills input only, and signatures survive truncation. */
export const MAX_LOG_CHARS = 2000;

export const DEPLOY_QUESTIONS: Questions = {
  known: {
    type: "noul",
    instructions:
      "Does this deploy log match a known diagnosable failure signature: a missing native binding, an engine mismatch (alone it is a repo hint; tied to a missing binding it is the diagnosis), a lockfile platform gap, a stale toolchain marker, an exec format error, a Prisma engine failure, a shared-library load failure, or a missing start command (nixpacks 'No start command', or a container log holding only `bash -c: option requires an argument`)?",
    criteria: {
      true: "the log contains one of the known signatures",
      false: "a generic failure with no named signature",
    },
  },
  fault: {
    type: "choice",
    instructions: "If diagnosable, whose fault is it?",
    criteria: {
      platform: "stale platform build image: the log prints a nixpacks version below 1.41.0 together with a missing native binding — refresh the build image, do not blame the repo",
      repo: "repo config the user can fix: undeclared Node version (nixpacks 1.41.0 or newer with a missing binding means the repo must declare engines.node/.nvmrc), native binding missing because the lockfile was generated on another OS/arch, Dockerfile --platform pin for the wrong CPU, Prisma engine failure needing a Debian image with OpenSSL plus linux-arm64 binaryTargets on ARM hosts, shared library missing from the base image, or a missing start command (nixpacks No start command, or a container log holding only `bash -c: option requires an argument`)",
      unknown: "no diagnosable signature; cannot attribute",
    },
  },
};

export function buildState(phase: "build" | "crash", armHost: boolean, log: string): JudgmentState {
  const trimmed = log.length > MAX_LOG_CHARS ? log.slice(-MAX_LOG_CHARS) : log;
  return { phase, arm_host: armHost, log: trimmed };
}

export function knownProb(answers: Record<string, Answer>): number {
  const a = answers.known;
  if (a === undefined || a.type !== "noul") throw new Error('eval: missing "known" noul answer');
  return a.noul;
}

export function faultOf(answers: Record<string, Answer>): Fault {
  const a = answers.fault;
  if (a === undefined || a.type !== "choice") throw new Error('eval: missing "fault" choice answer');
  if (a.choice !== "platform" && a.choice !== "repo" && a.choice !== "unknown") {
    throw new Error(`eval: unexpected fault choice ${JSON.stringify(a.choice)}`);
  }
  return a.choice;
}

export function faultConfidence(answers: Record<string, Answer>): number {
  const a = answers.fault;
  if (a === undefined || a.type !== "choice") throw new Error('eval: missing "fault" choice answer');
  return a.confidence;
}

/** Shadow gate: surface only a confident, attributable diagnosis. */
export function isSurfaced(answers: Record<string, Answer>, threshold: number = KNOWN_THRESHOLD): boolean {
  return knownProb(answers) >= threshold && faultOf(answers) !== "unknown";
}
