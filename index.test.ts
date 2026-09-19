import { describe, expect, test } from "bun:test";
import type { AgentToolResult } from "@oh-my-pi/pi-coding-agent";
import type { DecisionResult } from "./decision.ts";
import { createDecisionTool, decisionSchema, toQuestions, type DecisionTool, type DecisionToolOptions } from "./index.ts";

const CONFIG = { baseUrl: "https://api.typesafe.ai", apiKey: "k", model: "jev-latest" };
const PARAMS = {
  state: "ERROR disk full on /var at 03:12",
  questions: {
    urgent: { type: "noul", instructions: "Is this incident urgent?" },
    triage: {
      type: "choice",
      instructions: "Which queue does this belong to?",
      options: { infra: "host, disk or network faults", billing: "money-related" },
    },
  },
};

function stubFetch(reply: { status?: number; body?: unknown; text?: string }): DecisionToolOptions["fetch"] {
  const calls: RequestInit[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    calls.push(init ?? {});
    return new Response(reply.text ?? JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  }) as typeof fetch;
  return Object.assign(fetchImpl, { calls });
}

/** The harness passes a context argument this tool never reads. */
type HarnessExecute = (id: string, params: unknown) => Promise<AgentToolResult<DecisionResult>>;

function run(tool: DecisionTool, params: unknown): Promise<AgentToolResult<DecisionResult>> {
  const execute = tool.execute as unknown as HarnessExecute;
  return execute.call(tool, "call-1", params);
}

function textOf(result: AgentToolResult<DecisionResult>): string {
  for (const block of result.content) {
    if (block.type === "text") return block.text;
  }
  return "";
}

describe("toQuestions", () => {
  test("folds options, levels and yes/no onto the wire's criteria field", () => {
    expect(
      toQuestions({
        urgent: { type: "noul", instructions: "urgent?", yes: "drop everything", no: "queue it" },
        plain: { type: "noul", instructions: "plain?" },
        triage: { type: "choice", instructions: "queue?", options: { infra: "faults", billing: "money" } },
        severity: { type: "score", instructions: "how bad?", levels: ["minor", "major"] },
      }),
    ).toEqual({
      urgent: { type: "noul", instructions: "urgent?", criteria: { true: "drop everything", false: "queue it" } },
      plain: { type: "noul", instructions: "plain?" },
      triage: { type: "choice", instructions: "queue?", criteria: { infra: "faults", billing: "money" } },
      severity: { type: "score", instructions: "how bad?", criteria: ["minor", "major"] },
    });
  });

  test("names the question that is missing its answer space", () => {
    expect(() => toQuestions({ triage: { type: "choice", instructions: "queue?" } })).toThrow(
      'question "triage": choice questions need `options`',
    );
  });
});

describe("decide tool", () => {
  test("registers as a read-tier tool named `decide`", () => {
    const tool = createDecisionTool();
    expect(tool.name).toBe("decide");
    expect(tool.approval).toBe("read");
    expect(tool.description).toContain("noul");
  });

  test("schema keeps typed questions and rejects an unknown type", () => {
    expect(Object.keys(decisionSchema.parse(PARAMS).questions)).toEqual(["urgent", "triage"]);
    expect(() =>
      decisionSchema.parse({ state: "x", questions: { q: { type: "guess", instructions: "?" } } }),
    ).toThrow();
  });

  test("sends the folded questions and returns answers, model and cost as JSON", async () => {
    const fetch = stubFetch({
      body: {
        model: "jev-1.13.0",
        vendor: "typesafe",
        answers: { urgent: { type: "noul", noul: 0.88 } },
        usage: { input_tokens: 405, output_tokens: 69, cost: 0.00001701 },
      },
    });
    const tool = createDecisionTool({ config: CONFIG, fetch });

    expect(JSON.parse(textOf(await run(tool, PARAMS)))).toEqual({
      model: "jev-1.13.0",
      vendor: "typesafe",
      answers: { urgent: { type: "noul", noul: 0.88 } },
      usage: { input_tokens: 405, output_tokens: 69, cost_usd: 0.00001701 },
    });
    expect(JSON.parse(String((fetch as unknown as { calls: RequestInit[] }).calls[0]?.body))).toEqual({
      model: "jev-latest",
      state: PARAMS.state,
      questions: {
        urgent: { type: "noul", instructions: "Is this incident urgent?" },
        triage: {
          type: "choice",
          instructions: "Which queue does this belong to?",
          criteria: { infra: "host, disk or network faults", billing: "money-related" },
        },
      },
    });
  });

  test("reports a failed call as text instead of throwing", async () => {
    const tool = createDecisionTool({ config: CONFIG, fetch: stubFetch({ status: 500, text: "boom" }) });
    expect(textOf(await run(tool, PARAMS))).toBe("Decision failed: Decision request failed (500): boom");
  });
});
