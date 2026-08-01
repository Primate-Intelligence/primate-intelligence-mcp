/**
 * Tool definitions for @primate-intelligence/mcp (design §5, PRI-438 P9).
 *
 * Tool descriptions and schemas mirror the OpenAPI document served at
 * GET /v1/openapi.json — the spec is the source of truth. v0.2 scope:
 *   create_video_from_url, create_analysis, validate_analysis,
 *   create_analysis_batch, get_analysis, wait_for_analysis, list_models,
 *   get_usage, get_credits, get_test_fixture.
 *
 * SECURITY: PRIMATE_API_KEY comes from the environment only — no tool
 * accepts a key argument (§5.3: prevents keys landing in transcripts).
 */
import { z } from 'zod';
import { api, ApiError } from './api.js';

/** MCP tool annotations (directory requirement: title + readOnlyHint/destructiveHint). */
export interface ToolAnnotations {
  title: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDef<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  annotations: ToolAnnotations;
  schema: Shape;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Format API errors so agents can self-correct (code + docs_url + retryability). */
export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    const parts = [
      `API error ${e.body.code} (HTTP ${e.status}): ${e.body.message}`,
      e.body.docs_url ? `Docs: ${e.body.docs_url}` : '',
      e.body.request_id ? `request_id: ${e.body.request_id}` : '',
    ];
    return parts.filter(Boolean).join('\n');
  }
  return e instanceof Error ? e.message : String(e);
}

const TERMINAL = new Set(['completed', 'failed', 'canceled']);

interface Analysis {
  id: string;
  status: string;
  [k: string]: unknown;
}

export const TOOLS: ToolDef[] = [
  {
    name: 'create_video_from_url',
    annotations: {
      title: 'Ingest video from URL',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      'Register a video from a public https URL for analysis (POST /v1/videos, URL-ingest mode). ' +
      'The API fetches the video asynchronously — the returned video starts in status "processing" and becomes "ready". ' +
      'Supports video/mp4 and video/quicktime, max 2 GiB. Returns the video resource with its id (video_…).',
    schema: {
      url: z.string().url().describe('Public https URL of the video to ingest (https only, port 443).'),
      metadata: z.record(z.string(), z.string()).optional().describe('Optional key-value metadata to attach.'),
    },
    handler: (args) => api('POST', '/v1/videos', { url: args.url, metadata: args.metadata }),
  },
  {
    name: 'create_analysis',
    annotations: {
      title: 'Analyze video',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description:
      'Ask a question about a video (POST /v1/analyses). Provide video_id (video_…) and a free-text prompt like ' +
      '"Is there a person in this video?". Analysis runs asynchronously — use wait_for_analysis to block until done. ' +
      'The result contains answer (yes|no|indeterminate), confidence (0-1), clip timestamps, detected_count (count ' +
      'queries), and indeterminate_reason. Recommended: call validate_analysis first to confirm the prompt is ' +
      'assessable and preview the cost before spending credits. For 2–10 prompts on the same video, use ' +
      'create_analysis_batch (each prompt after the first is billed at 50%).',
    schema: {
      video_id: z.string().describe('The video to analyze (video_… id from create_video_from_url).'),
      prompt: z.string().max(2000).describe('Free-text question about the video, e.g. "Is there a person in this video?"'),
      model: z.string().optional().describe('Model id (see list_models). Defaults to the current default model.'),
      metadata: z.record(z.string(), z.string()).optional().describe('Optional key-value metadata to attach.'),
    },
    handler: (args) =>
      api('POST', '/v1/analyses', {
        video_id: args.video_id,
        prompt: args.prompt,
        model: args.model,
        metadata: args.metadata,
      }),
  },
  {
    name: 'validate_analysis',
    annotations: {
      title: 'Validate prompt & preview cost (free)',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    description:
      'Dry-run a prompt WITHOUT creating an analysis or spending credits (POST /v1/analyses with validate_only: true). ' +
      'Compiles the prompt and returns an analysis_preview: the compiled query, assessable (false means the model ' +
      'cannot score this query form — rephrase as a yes/no or count question), estimated_seconds, and ' +
      'estimated_cost_usd (both null when the video duration is not yet known). ' +
      'Recommended before create_analysis to catch unassessable prompts and preview cost.',
    schema: {
      video_id: z.string().describe('The video the analysis would run against (video_… id).'),
      prompt: z.string().max(2000).describe('Free-text question to validate, e.g. "How many people are walking?"'),
      model: z.string().optional().describe('Model id (see list_models). Defaults to the current default model.'),
    },
    handler: (args) =>
      api('POST', '/v1/analyses', {
        video_id: args.video_id,
        prompt: args.prompt,
        model: args.model,
        validate_only: true,
      }),
  },
  {
    name: 'create_analysis_batch',
    annotations: {
      title: 'Analyze video with multiple prompts (batch discount)',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description:
      'Run 2–10 prompts against the SAME video in one call (POST /v1/analyses/batch). Pricing: the first prompt is ' +
      'billed at full price, each additional prompt at 50% — always cheaper than separate create_analysis calls for ' +
      'multi-question workloads. Returns an analysis_batch with every analysis resource plus a pricing summary; ' +
      'poll each analysis id individually with get_analysis or wait_for_analysis. ' +
      'To check assessability of individual prompts first, use validate_analysis (free).',
    schema: {
      video_id: z.string().describe('The video to analyze (video_… id).'),
      prompts: z.array(z.string().min(1).max(2000)).min(2).max(10)
        .describe('2–10 free-text prompts. First is full price; each additional is billed at 50%.'),
      model: z.string().optional().describe('Model id (see list_models). Defaults to the current default model.'),
      metadata: z.record(z.string(), z.string()).optional().describe('Optional key-value metadata attached to every analysis in the batch.'),
    },
    handler: (args) =>
      api('POST', '/v1/analyses/batch', {
        video_id: args.video_id,
        prompts: args.prompts,
        model: args.model,
        metadata: args.metadata,
      }),
  },
  {
    name: 'get_analysis',
    annotations: {
      title: 'Get analysis result',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    description:
      'Fetch an analysis by id (GET /v1/analyses/{id}). While running, shows live progress and queue_position. ' +
      'When status is "completed": result.answer (yes|no|indeterminate), result.confidence (for count queries this is ' +
      'confidence in the count itself), result.clips, result.detected_count (count-intent queries only; 0 = assessable ' +
      'but nothing found), result.indeterminate_reason (low_confidence — retry with a more specific prompt; ' +
      'nothing_detected — genuinely empty; unsupported_query_form — rephrase as yes/no or count; duration_mismatch — ' +
      'result untrusted), and result.video_duration_s (null when duration could not be determined). ' +
      'usage is {billed_seconds, credit_balance_after} — an immutable post-settlement snapshot.',
    schema: {
      analysis_id: z.string().describe('The analysis id (an_…).'),
    },
    handler: (args) => api('GET', `/v1/analyses/${args.analysis_id}`),
  },
  {
    name: 'wait_for_analysis',
    annotations: {
      title: 'Wait for analysis to finish',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    description:
      'Block until an analysis reaches a terminal state (completed | failed | canceled), polling GET /v1/analyses/{id}. ' +
      'Returns { analysis, retry }: retry is null when the analysis reached a terminal state, or carries timeout guidance ' +
      'when the wait expired (call again). Default timeout 120s (test-mode analyses complete in seconds). ' +
      'On completion, see get_analysis for the full result field semantics (detected_count, indeterminate_reason, ' +
      'nullable video_duration_s, usage snapshot).',
    schema: {
      analysis_id: z.string().describe('The analysis id (an_…).'),
      timeout_s: z.number().int().min(1).max(600).optional().describe('Max seconds to wait (default 120).'),
    },
    handler: async (args) => {
      const timeoutMs = ((args.timeout_s as number | undefined) ?? 120) * 1000;
      const deadline = Date.now() + timeoutMs;
      let analysis = await api<Analysis>('GET', `/v1/analyses/${args.analysis_id}`);
      while (!TERMINAL.has(analysis.status)) {
        if (Date.now() > deadline) {
          // The analysis resource stays unmodified; retry guidance is a sibling
          // field, never merged into the documented resource shape (F-1).
          return {
            analysis,
            retry: {
              reason: 'timeout' as const,
              note: `Timed out after ${args.timeout_s ?? 120}s — analysis is still ${analysis.status}. Call wait_for_analysis again or get_analysis later.`,
            },
          };
        }
        await new Promise((r) => setTimeout(r, 2000));
        analysis = await api<Analysis>('GET', `/v1/analyses/${args.analysis_id}`);
      }
      return { analysis, retry: null };
    },
  },
  {
    name: 'list_models',
    annotations: {
      title: 'List analysis models',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    description:
      'List available analysis models (GET /v1/models) with status (stable | preview | deprecated) and capabilities. ' +
      'Use the model marked default:true unless you have a reason not to.',
    schema: {},
    handler: () => api('GET', '/v1/models'),
  },
  {
    name: 'get_usage',
    annotations: {
      title: 'Get usage & credit balance',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    description:
      'Get credit balance and period usage meters for the current API key (GET /v1/usage). ' +
      'Use this after an insufficient_credits error to report the balance. ' +
      'For the per-analysis transaction ledger (what each analysis cost, with source ids), use get_credits instead.',
    schema: {},
    handler: () => api('GET', '/v1/usage'),
  },
  {
    name: 'get_credits',
    annotations: {
      title: 'Get credit balance & transaction history',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    description:
      'Get the credit balance and transaction ledger for this API key (GET /v1/credits). Returns balance_seconds ' +
      '(the authoritative balance, in billable seconds), grant_seconds, used_seconds, and a paginated transaction ' +
      'list where each debit carries the analysis/stream id it came from (source_id, source_type). ' +
      'Use this to audit what each analysis cost, check the balance before a batch job, or diagnose an ' +
      'insufficient_credits error.',
    schema: {
      limit: z.number().int().min(1).max(100).optional().describe('Transactions per page (default 20).'),
      before: z.string().optional().describe('Cursor — return transactions older than this id.'),
    },
    handler: (args) => {
      const qs = new URLSearchParams();
      if (args.limit !== undefined) qs.set('limit', String(args.limit));
      if (args.before !== undefined) qs.set('before', String(args.before));
      const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
      return api('GET', `/v1/credits${suffix}`);
    },
  },
  {
    name: 'get_test_fixture',
    annotations: {
      title: 'Get test fixture',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    description:
      'Get the stable test fixture (GET /v1/test-fixture): a video URL + prompt + expected answer for verifying an ' +
      'integration end-to-end without burning quota. Test-mode (pv_test_) keys return deterministic canned results.',
    schema: {},
    handler: () => api('GET', '/v1/test-fixture'),
  },
];
