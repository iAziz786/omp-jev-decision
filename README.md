# omp-jev-decision

[omp](https://omp.sh) extension that adds a `decision` tool backed by
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

Use it where a chat model would otherwise write a sentence you have to parse: routing,
triage, thresholds, guardrails, "does this deserve the expensive model?" — the answers are
numbers you can branch on. It cannot generate text, so ask narrow questions rather than
compound ones, and batch independent questions into a single call.

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

### Through the Merge Dev gateway

The gateway serves the same System One contract — same request, same answers — at
`/v1/decisions` under the model id `typesafe/jev-1.13`. The bridge in
[iAziz786/pi-merge-gateway-login](https://github.com/iAziz786/pi-merge-gateway-login)
maps the client's path and model id onto it, so pointing the base URL at the bridge is
all that changes:

```bash
TYPESAFE_BASE_URL=http://127.0.0.1:8787
TYPESAFE_API_KEY=<merge gateway key>
TYPESAFE_DEFAULT_MODEL=typesafe/jev-1.13
```

## Notes

- Read-tier tool: it makes one HTTPS call and returns text; nothing on disk is touched.
- Cost: TypeSafe bills $0.042 per million input tokens with output free. The gateway
  reports the exact figure per call (`usage.cost`), surfaced here as `usage.cost_usd`;
  direct TypeSafe responses carry no cost field, so it reads `null`.
- Requests are not sent through any model provider registration, so this works
  independently of which chat model the session uses.

## Development

```bash
bun install
bun test
bun run build
```

MIT © Mohammad Aziz
