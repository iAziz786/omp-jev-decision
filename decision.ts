/**
 * TypeSafe System One client (Jev): typed questions in, typed answers out.
 *
 * Wire contract — `POST {baseUrl}/v1/systemone`:
 *   request  { model, state, questions: { id: { type, instructions, criteria? } } }
 *   response { model, vendor, answers: { id: { type, ... } }, usage: {...} }
 * The Merge Dev gateway serves the same contract at `/v1/decisions` under the
 * model id `typesafe/jev-1.13`; the bridge in iAziz786/pi-merge-gateway-login
 * maps one to the other, so this client stays switched by the base URL alone.
 *
 * Configuration follows omp's own TypeSafe judge so one env block serves both:
 *   TYPESAFE_BASE_URL      API root            (default https://api.typesafe.ai)
 *   TYPESAFE_API_KEY       bearer token        (required)
 *   TYPESAFE_DEFAULT_MODEL model id            (default jev-latest)
 */

/** Pick one option from a fixed set: `criteria` maps option → description. */
export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

/** Probability that a yes/no condition holds; `criteria` spells out what yes and no mean. */
export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true?: string; false?: string };
}

/** Position on ordered levels: `criteria` lists level descriptions, lowest first. */
export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export type QuestionType = "choice" | "noul" | "score";
export type QuestionCriteria = Record<string, string> | string[] | { true?: string; false?: string };
export type Question = ChoiceQuestion | NoulQuestion | ScoreQuestion;

/** Questions keyed by caller-chosen ids; answers come back under the same ids. */
export type Questions = Record<string, Question>;

/** Content to evaluate: plain text, or structured data. */
export type JudgmentState = string | Record<string, unknown> | unknown[];

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
  /** Level index mapped to its description, as echoed by the vendor. */
  legend?: Record<string, string>;
}

export type Answer = ChoiceAnswer | NoulAnswer | ScoreAnswer;

/** Token usage of one call; `cost` is the vendor's own USD figure when reported. */
export interface DecisionUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
}

export interface DecisionResult {
  /** Resolved vendor model id (e.g. `jev-1.13.0`), not the requested alias. */
  model: string;
  vendor: string;
  answers: Record<string, Answer>;
  usage: DecisionUsage;
}

export interface DecisionConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_MODEL = "jev-latest";

/** Response fields this client reads; the vendor owns the rest. */
interface SystemOneResponse {
  model?: string;
  vendor?: string;
  answers?: Record<string, Answer>;
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number | null };
}

/**
 * Resolve the `TYPESAFE_*` block; throws when no key is configured, so a
 * misconfigured tool call reports the missing variable instead of a 401.
 */
export function decisionConfig(env: Record<string, string | undefined> = process.env): DecisionConfig {
  const apiKey = env.TYPESAFE_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("TYPESAFE_API_KEY is not set (and TYPESAFE_BASE_URL/TYPESAFE_DEFAULT_MODEL are optional)");
  }
  return {
    baseUrl: (env.TYPESAFE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    apiKey,
    model: env.TYPESAFE_DEFAULT_MODEL?.trim() || DEFAULT_MODEL,
  };
}

export interface DecideOptions {
  config?: DecisionConfig;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

/** Ask one decision model the caller's typed questions about `state`. */
export async function decide(
  input: { state: JudgmentState; questions: Questions },
  options: DecideOptions = {},
): Promise<DecisionResult> {
  const config = options.config ?? decisionConfig();
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(`${config.baseUrl}/v1/systemone`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ model: config.model, state: input.state, questions: input.questions }),
    signal: options.signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Decision request failed (${response.status}): ${text.slice(0, 500)}`);
  }
  // Boundary assert: the vendor's documented response shape, checked below.
  let parsed: SystemOneResponse;
  try {
    parsed = JSON.parse(text) as SystemOneResponse;
  } catch {
    throw new Error(`Decision response is not JSON: ${text.slice(0, 200)}`);
  }
  if (parsed.model === undefined || parsed.answers === undefined) {
    throw new Error(`Decision response is missing "model" or "answers": ${text.slice(0, 200)}`);
  }
  return {
    model: parsed.model,
    vendor: parsed.vendor ?? "typesafe",
    answers: parsed.answers,
    usage: {
      inputTokens: parsed.usage?.input_tokens ?? 0,
      outputTokens: parsed.usage?.output_tokens ?? 0,
      cost: parsed.usage?.cost ?? null,
    },
  };
}
