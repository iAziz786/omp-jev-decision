import { describe, expect, test } from "bun:test";
import { DEFAULT_BASE_URL, DEFAULT_MODEL, decide, decisionConfig, type DecisionConfig, type Questions } from "./decision.ts";

const CONFIG: DecisionConfig = { baseUrl: "https://api.typesafe.ai", apiKey: "k", model: "jev-latest" };
const QUESTIONS: Questions = { urgent: { type: "noul", instructions: "Is this incident urgent?" } };

/** Minimal fetch double: records every call, returns one canned reply. */
function stubFetch(reply: { status?: number; body?: unknown; text?: string }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(reply.text ?? JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

describe("decisionConfig", () => {
  test("defaults the base URL and model, keeps the key", () => {
    expect(decisionConfig({ TYPESAFE_API_KEY: "k" })).toEqual({
      baseUrl: DEFAULT_BASE_URL,
      apiKey: "k",
      model: DEFAULT_MODEL,
    });
  });

  test("honours the env overrides and strips trailing slashes", () => {
    expect(
      decisionConfig({
        TYPESAFE_API_KEY: "k",
        TYPESAFE_BASE_URL: "http://127.0.0.1:8787/",
        TYPESAFE_DEFAULT_MODEL: "typesafe/jev-1.13",
      }),
    ).toEqual({ baseUrl: "http://127.0.0.1:8787", apiKey: "k", model: "typesafe/jev-1.13" });
  });

  test("refuses to guess a key", () => {
    expect(() => decisionConfig({})).toThrow("TYPESAFE_API_KEY");
  });
});

describe("decide", () => {
  test("posts the question set to the System One endpoint", async () => {
    const { fetch, calls } = stubFetch({ body: { model: "jev-1.13.0", answers: {} } });
    await decide({ state: { log: "disk full" }, questions: QUESTIONS }, { config: CONFIG, fetch });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(calls[0]?.init.method).toBe("POST");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      model: "jev-latest",
      state: { log: "disk full" },
      questions: QUESTIONS,
    });
  });

  test("maps answers and usage, including the vendor's own cost", async () => {
    const { fetch } = stubFetch({
      body: {
        model: "jev-1.13.0",
        vendor: "typesafe",
        answers: { urgent: { type: "noul", noul: 0.87 } },
        usage: { input_tokens: 405, output_tokens: 69, cost: 0.00001701 },
      },
    });

    expect(await decide({ state: "x", questions: QUESTIONS }, { config: CONFIG, fetch })).toEqual({
      model: "jev-1.13.0",
      vendor: "typesafe",
      answers: { urgent: { type: "noul", noul: 0.87 } },
      usage: { inputTokens: 405, outputTokens: 69, cost: 0.00001701 },
    });
  });

  test("reports an unreported cost as null rather than zero", async () => {
    const { fetch } = stubFetch({ body: { model: "jev-1.13.0", answers: {}, usage: { input_tokens: 5, output_tokens: 1 } } });
    expect((await decide({ state: "x", questions: QUESTIONS }, { config: CONFIG, fetch })).usage.cost).toBeNull();
  });

  test("surfaces the vendor's status and detail", async () => {
    const { fetch } = stubFetch({ status: 422, text: '{"detail":"criteria must be strings"}' });
    await expect(decide({ state: "x", questions: QUESTIONS }, { config: CONFIG, fetch })).rejects.toThrow(
      /422.*criteria must be strings/,
    );
  });

  test("rejects a response without answers", async () => {
    const { fetch } = stubFetch({ body: { model: "jev-1.13.0" } });
    await expect(decide({ state: "x", questions: QUESTIONS }, { config: CONFIG, fetch })).rejects.toThrow(
      'missing "model" or "answers"',
    );
  });

  test("rejects a non-JSON body", async () => {
    const { fetch } = stubFetch({ text: "<html>gateway</html>" });
    await expect(decide({ state: "x", questions: QUESTIONS }, { config: CONFIG, fetch })).rejects.toThrow("not JSON");
  });
});
