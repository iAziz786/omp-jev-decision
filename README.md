# omp-jev-decision

[omp](https://omp.sh) extension that adds a `decide` tool backed by
[TypeSafe](https://www.typesafe.ai) System One ("Jev") — a model that generates no
prose, only typed answers.

Hand it a piece of state (log line, ticket, diff, JSON blob) plus questions with fixed
answer spaces, and it returns one typed answer per question with probabilities:

- `choice` — pick one option from a set you define
- `noul` — probability that a yes/no condition holds
- `score` — position on ordered levels

```jsonc
// tool call
{
  "state": "ERROR disk full on /var at 03:12 (host api-3)",
  "questions": {
    "urgent": { "type": "noul", "instructions": "Is this incident urgent?" },
    "triage": {
      "type": "choice",
      "instructions": "Which queue does this belong to?",
      "options": { "infra": "host, disk or network faults", "billing": "money-related", "other": "anything else" }
    },
    "severity": { "type": "score", "instructions": "How severe is this?", "levels": ["trivial", "minor", "major", "outage"] }
  }
}

// tool result
{
  "model": "jev-1.13.0",
  "vendor": "typesafe",
  "answers": {
    "urgent": { "type": "noul", "noul": 0.88 },
    "triage": { "type": "choice", "choice": "infra", "confidence": 1, "probabilities": { "infra": 1, "billing": 0, "other": 0 } },
    "severity": { "type": "score", "score": 2.24, "confidence": 0.74, "probabilities": { "2": 0.75, "3": 0.25 } }
  },
  "usage": { "input_tokens": 405, "output_tokens": 69, "cost_usd": 0.00001701 }
}
```

The answer space is split per type — `options` for `choice`, `levels` for `score`, optional `yes`/`no` for `noul` — rather than the wire's single polymorphic `criteria` field, so a model fills it in correctly; the tool folds them back before the request.

## Where it fits

The pattern that holds up in the wild is picks, gates and judgments on small, repeated
decisions around a stronger model rather than instead of one:

- pick — which route, tool or queue
- gate — keep or drop, done or not done, does this deserve the expensive model?
- judge — relevance, urgency, policy compliance

Batch the independent questions onto one `state`; the answers are numbers you can branch
on. It generates no text, so ask narrow questions rather than compound asks like "explain
and fix", and do not run it as the main reasoner. Log the probabilities and compare them
against what actually happened before you let the answers dispatch anything on their own.

## Install

```bash
omp install npm:@iaziz786/omp-jev-decision
# or load a checkout directly
omp -e ./index.ts
```

## Configuration

The tool reads the same `TYPESAFE_*` environment block omp's built-in TypeSafe judge
uses, so one block configures both:

| variable | default | meaning |
|---|---|---|
| `TYPESAFE_API_KEY` | — (required) | bearer token |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | API root |
| `TYPESAFE_DEFAULT_MODEL` | `jev-latest` | model id |

`~/.omp/agent/.env` is loaded into the environment by omp; a shell export works too. A
missing key reports `TYPESAFE_API_KEY is not set` at call time instead of a 401.

### How omp presents this tool

omp mounts extension tools as *discoverable* devices: the system prompt carries a one-line
summary — the first line of the description, capped at 200 bytes for third-party tools —
and the model fetches the rest, description and schema, with `read xd://decide`. Only that
first line is always paid for, so it states the trigger; everything below it is reference
material read before the first call.

`tools.xdevDocs: "inline"` (or `tools.xdevInlineDevices: ["decide"]` on the default
`builtins` mode) puts an inline copy in the prompt and skips the read — but the
200-byte cap applies there too, so the sections only ever arrive in full through the
on-demand fetch.

### Other hosts

`TYPESAFE_BASE_URL` is the switch: the request goes to `{base}/v1/systemone` with
`TYPESAFE_DEFAULT_MODEL` as the model id, so any endpoint implementing the same
contract works.

## Notes

- Read-tier tool: it makes one HTTPS call and returns text; nothing on disk is touched.
- Cost: TypeSafe bills $0.042 per million input tokens with output free. The gateway
  reports the exact figure per call (`usage.cost`), surfaced here as `usage.cost_usd`;
  direct TypeSafe responses carry no cost field, so it reads `null`.
- Requests are not sent through any model provider registration, so this works
  independently of which chat model the session uses.

## Eval

`eval/` scores the deploy-diagnosis fallback question set (`eval/questions.ts`) against golden log cases (`eval/cases.jsonl`), predicted vs expected:

```bash
bun eval/run.ts --dry-run   # offline: validates the case file and scoring, spends nothing
bun eval/run.ts             # live: needs TYPESAFE_API_KEY; exits 1 when the gate fails
```

Placement contract: deterministic classifiers run first and Jev only sees their `nil` branch; a note surfaces only when P(known) clears the threshold and fault is not `unknown`. The gate fails hard on any invented diagnosis.

## Development

```bash
bun install
bun test
bun run build
```

MIT © Mohammad Aziz
