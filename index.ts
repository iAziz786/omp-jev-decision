/**
 * omp extension: a `decision` tool backed by TypeSafe System One (Jev).
 *
 * The tool answers typed questions about any state — `choice` (pick one of a
 * fixed set), `noul` (probability a yes/no condition holds), `score` (position
 * on ordered levels) — in one pass, with probabilities instead of prose. It is
 * the on-demand counterpart of the judgments omp already makes internally.
 *
 * Endpoint and credentials come from the shared `TYPESAFE_*` block (see
 * decision.ts), so this tool and omp's built-in judge can point at the same
 * place: TypeSafe directly, or the Merge Dev gateway's `typesafe/jev-1.13`
 * through the bridge in iAziz786/pi-merge-gateway-login.
 */

import type { ExtensionAPI, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { z } from "@oh-my-pi/omptype/zod";
import { decide, type DecisionConfig, type DecisionResult, type JudgmentState, type QuestionType, type Questions } from "./decision.ts";

/**
 * One typed question, flattened for the caller: the wire contract folds each
 * type's answer space into one polymorphic `criteria` field, which is exactly
 * the kind of shape a model gets wrong, so `options`/`levels`/`yes`/`no` are
 * separate here and {@link toQuestions} folds them back.
 */
export const questionSchema = z.object({
  type: z
    .union([z.literal("choice"), z.literal("noul"), z.literal("score")])
    .describe("choice = pick one option; noul = probability of yes; score = position on ordered levels"),
  instructions: z.string().describe("What this question asks"),
  options: z
    .record(z.string(), z.string())
    .optional()
    .describe("choice only: every option mapped to its description, at least two"),
  levels: z.array(z.string()).optional().describe("score only: level descriptions from lowest to highest, at least two"),
  yes: z.string().optional().describe("noul only: what counts as yes, when the question needs spelling out"),
  no: z.string().optional().describe("noul only: what counts as no"),
});

export const decisionSchema = z.object({
  state: z
    .union([z.string(), z.record(z.unknown()), z.array(z.unknown())])
    .describe("Content to evaluate: text, or structured data (object/array) such as a log line, ticket, diff or record"),
  questions: z
    .record(questionSchema)
    .describe("Questions keyed by caller-chosen id; each is answered independently, and answers come back under the same ids"),
});

/** One question as the tool receives it. */
export interface QuestionParams {
  type: QuestionType;
  instructions: string;
  options?: Record<string, string>;
  levels?: string[];
  yes?: string;
  no?: string;
}

export type QuestionParamMap = Record<string, QuestionParams>;

export interface DecisionParams {
  state: JudgmentState;
  questions: QuestionParamMap;
}

/** Fold the caller's flattened question into the wire's `criteria` field. */
export function toQuestions(questions: QuestionParamMap): Questions {
  const wire: Questions = {};
  for (const id of Object.keys(questions)) {
    const question = questions[id];
    if (question.type === "choice") {
      if (question.options === undefined) {
        throw new Error(`question "${id}": choice questions need \`options\` (option → description)`);
      }
      wire[id] = { type: "choice", instructions: question.instructions, criteria: question.options };
      continue;
    }
    if (question.type === "score") {
      if (question.levels === undefined) {
        throw new Error(`question "${id}": score questions need \`levels\` (lowest first)`);
      }
      wire[id] = { type: "score", instructions: question.instructions, criteria: question.levels };
      continue;
    }
    wire[id] = {
      type: "noul",
      instructions: question.instructions,
      ...(question.yes === undefined && question.no === undefined
        ? {}
        : { criteria: { true: question.yes, false: question.no } }),
    };
  }
  return wire;
}

export interface DecisionToolOptions {
  /** Injectable transport and configuration, for tests. */
  fetch?: typeof fetch;
  config?: DecisionConfig;
}

/** The `decision` tool contract, as the harness sees it. */
export type DecisionTool = ToolDefinition<typeof decisionSchema, DecisionResult>;

/** Tool text: the answers plus what produced them, so cost and confidence stay visible. */
function renderDecision(result: DecisionResult): string {
  return JSON.stringify(
    {
      model: result.model,
      vendor: result.vendor,
      answers: result.answers,
      usage: {
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cost_usd: result.usage.cost,
      },
    },
    null,
    2,
  );
}

/** The `decision` tool; exported so tests can drive it with a stubbed transport. */
export function createDecisionTool(options: DecisionToolOptions = {}): DecisionTool {
  return {
    name: "decision",
    label: "Decision (Jev)",
    description:
      "Ask a decision model (TypeSafe System One / Jev) typed questions about a piece of state and get typed answers back: " +
      "`choice` picks one option from the `options` you define, `noul` returns the probability of a yes/no condition, `score` places the state on ordered `levels`. " +
      "Answers carry probabilities (and a confidence where applicable). " +
      "Use it for classification, routing, triage, thresholds or guardrails that a chat model would otherwise answer in prose; it cannot generate text, so ask narrow questions rather than compound ones, and batch independent questions into one call.",
    parameters: decisionSchema,
    approval: "read",
    async execute(_toolCallId, params, signal) {
      try {
        const result = await decide(
          { state: params.state, questions: toQuestions(params.questions) },
          { fetch: options.fetch, config: options.config, signal },
        );
        return { content: [{ type: "text", text: renderDecision(result) }], details: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Decision failed: ${message}` }] };
      }
    },
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool(createDecisionTool());
}
