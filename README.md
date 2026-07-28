# @primate-intelligence/mcp

[![npm](https://img.shields.io/npm/v/@primate-intelligence/mcp.svg)](https://www.npmjs.com/package/@primate-intelligence/mcp)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

MCP ([Model Context Protocol](https://modelcontextprotocol.io)) server for the **[Primate Vision API](https://primateintelligence.ai/docs)** by [Primate Intelligence](https://primateintelligence.ai).

Gives AI agents **video scene understanding** as tools: register a video, ask a question in plain English, get a deterministic answer with a confidence score and clip timestamps. No hallucinated descriptions — the answer is `yes` / `no` / `indeterminate` with evidence.

## Try it for free

A free test key requires no email, no card, no signup:

```bash
curl -X POST https://api.primateintelligence.ai/v1/sandbox
```

Your AI agent can do this for you — right from Claude. Point it at
[primateintelligence.ai/llms.txt](https://primateintelligence.ai/llms.txt) and it can
discover, provision, integrate, and self-verify with zero human steps.

## Two ways to connect

### 1. Remote server (recommended) — OAuth, nothing to install

Streamable HTTP endpoint with full OAuth 2.1 + Dynamic Client Registration + PKCE:

```
https://api.primateintelligence.ai/mcp
```

In Claude.ai / Claude Desktop: **Settings → Connectors → Add custom connector**, paste the URL, sign in. No API key handling — the OAuth flow issues and rotates tokens for you.

### 2. Local stdio server

```jsonc
// claude_desktop_config.json · .mcp.json · mcp.json · .cursor/mcp.json
{
  "mcpServers": {
    "primate-intelligence": {
      "command": "npx",
      "args": ["-y", "@primate-intelligence/mcp"],
      "env": { "PRIMATE_API_KEY": "pv_live_…" }
    }
  }
}
```

## Tools

| Tool | Does | Read-only |
|---|---|:--:|
| `create_video_from_url` | Register a video from a public https URL (`POST /v1/videos`) | — |
| `create_analysis` | Ask a question about a video (`POST /v1/analyses`) | — |
| `validate_analysis` | Dry-run a prompt: assessability + cost estimate, zero credits (`validate_only: true`) | ✓ |
| `create_analysis_batch` | 2–10 prompts on one video; each after the first billed at 50% (`POST /v1/analyses/batch`) | — |
| `get_analysis` | Fetch analysis status/result (`GET /v1/analyses/{id}`) | ✓ |
| `wait_for_analysis` | Poll until terminal state; returns `{ analysis, retry }` | ✓ |
| `list_models` | List available models (`GET /v1/models`) | ✓ |
| `get_usage` | Credit balance + period meters (`GET /v1/usage`) | ✓ |
| `get_credits` | Balance + per-analysis transaction ledger (`GET /v1/credits`) | ✓ |
| `get_test_fixture` | Stable fixture for integration self-verification (`GET /v1/test-fixture`) | ✓ |

Every tool carries MCP annotations (`title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), declares an `outputSchema`, and returns `structuredContent` conforming to it. No tool deletes data. Tool descriptions and schemas mirror the OpenAPI document at [`GET /v1/openapi.json`](https://api.primateintelligence.ai/v1/openapi.json) — the spec is the source of truth.

## Typical agent flow

1. `get_test_fixture` → verify the integration works (test keys return deterministic results, no quota burn)
2. `create_video_from_url` with the video URL
3. `validate_analysis` → confirm the prompt is assessable + preview `estimated_cost_usd` (free)
4. `create_analysis` with the question — *"Is there a person in this video?"* — or `create_analysis_batch` for several
5. `wait_for_analysis` → `result.answer` (`yes` | `no` | `indeterminate`) + `result.confidence` + `result.clips` + `result.detected_count` (count queries) + `result.indeterminate_reason`
6. On `insufficient_credits`: call `get_credits`, report the balance + recent debits, point the human at billing

## Security contract

The API key is read from the `PRIMATE_API_KEY` **environment variable only**. **No tool accepts a key, token, or secret as an argument** — so credentials never land in agent transcripts, tool-call logs, or model context. This is enforced by a unit test that fails the build if any tool schema grows a credential-shaped parameter.

Errors surface the machine-readable error `code`, a `docs_url`, and the `request_id` so an agent can self-correct without a human in the loop.

## Configuration

| Var | Required | Default |
|---|---|---|
| `PRIMATE_API_KEY` | yes | — |
| `PRIMATE_BASE_URL` | no | `https://api.primateintelligence.ai` |

## Development

```bash
npm install
npm test        # vitest — tool surface, security contract, polling, error shape
npm run build   # tsc → dist/
```

## Links

- [Quickstart for AI agents](https://primateintelligence.ai/docs/agents) — the zero-human-intervention integration path
- [API docs](https://primateintelligence.ai/docs)
- [OpenAPI 3.1 spec](https://api.primateintelligence.ai/v1/openapi.json)
- [Error registry](https://primateintelligence.ai/docs/errors)
- [llms.txt](https://primateintelligence.ai/llms.txt) — machine-readable index for agents
- [Privacy policy](https://primateintelligence.ai/privacy) · [Terms](https://primateintelligence.ai/terms)

## License

MIT © Primate AI, Inc.
