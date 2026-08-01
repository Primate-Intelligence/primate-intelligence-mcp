/**
 * Tool output schemas for @primate-intelligence/mcp (PRI-480 npm catch-up).
 *
 * Mirrors the hosted MCP endpoint's MCP_TOOL_OUTPUT_SCHEMAS (api repo
 * src/routes/mcp.ts), which derive from the public DTO Zod registry. The
 * module boundary (this package is standalone ESM) prevents a direct import;
 * keep in sync when the hosted schemas change. Per the MCP spec, a tool that
 * declares outputSchema MUST return structuredContent conforming to it — the
 * SDK validates every result at runtime.
 *
 * Shapes verified against the live OpenAPI document (GET /v1/openapi.json)
 * and recorded live responses, 2026-07-28.
 */
import { z } from 'zod';

const ErrorObjectSchema = z.object({
  code: z.string(),
  message: z.string(),
  status: z.number().optional(),
  param: z.string().nullable().optional(),
  docs_url: z.string().optional(),
  request_id: z.string().optional(),
}).passthrough();

export const VideoOutputSchema = z.object({
  id: z.string(),
  object: z.literal('video'),
  livemode: z.boolean().optional(),
  status: z.enum(['awaiting_upload', 'uploading', 'processing', 'ready', 'failed']),
  filename: z.string().nullable(),
  size_bytes: z.number().nullable(),
  duration_s: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  fps: z.number().nullable(),
  content_type: z.string(),
  source: z.string(),
  upload: z.record(z.string(), z.unknown()).nullable(),
  error: ErrorObjectSchema.nullable(),
  metadata: z.record(z.string(), z.string()).optional(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
}).passthrough();

const ClipSchema = z.object({
  start_s: z.number(),
  end_s: z.number(),
  confidence: z.number(),
}).passthrough();

const ResultSchema = z.object({
  answer: z.enum(['yes', 'no', 'indeterminate']),
  confidence: z.number(),
  clips: z.array(ClipSchema),
  term_confidences: z.record(z.string(), z.number()),
  query_type: z.enum(['object', 'action', 'compound', 'attribute', 'open_ended']),
  video_duration_s: z.number().nullable().describe('Null when the source duration could not be determined.'),
  detected_count: z.number().int().nullable().optional()
    .describe('Count-intent queries only. 0 = assessable but nothing found. confidence applies to the count itself.'),
  indeterminate_reason: z.enum(['low_confidence', 'nothing_detected', 'unsupported_query_form', 'duration_mismatch'])
    .nullable().optional()
    .describe('Present when answer is indeterminate. low_confidence: retry with a more specific prompt. nothing_detected: genuinely empty. unsupported_query_form: rephrase as yes/no or count. duration_mismatch: result untrusted.'),
}).passthrough();

const AnalysisUsageSchema = z.object({
  billed_seconds: z.number().int(),
  credit_balance_after: z.number().int().nullable(),
}).describe('Terminal only. Immutable snapshot of the balance after THIS analysis settled.');

export const AnalysisOutputSchema = z.object({
  id: z.string(),
  object: z.literal('analysis'),
  livemode: z.boolean(),
  origin: z.enum(['api', 'console', 'system']),
  status: z.enum(['queued', 'preparing', 'analyzing', 'rendering', 'completed', 'failed', 'canceled']),
  video_id: z.string(),
  prompt: z.string().nullable(),
  query: z.record(z.string(), z.unknown()).describe(
    'Compiled interpretation of the prompt (subjects, conditions, query_type, search_terms, prompt_intent, ' +
    'original_prompt, …). Transparency feature: shows how the question was understood.',
  ),
  parse_mode: z.enum(['llm', 'heuristic', 'client']).nullable(),
  model: z.string(),
  options: z.record(z.string(), z.unknown()),
  progress: z.object({ stage: z.string(), percent: z.number() }).passthrough().nullable(),
  queue_position: z.number().nullable(),
  result: ResultSchema.nullable(),
  narrative: z.record(z.string(), z.unknown()).nullable(),
  artifacts: z.record(z.string(), z.unknown()).nullable(),
  error: ErrorObjectSchema.nullable(),
  usage: AnalysisUsageSchema.nullable(),
  metadata: z.record(z.string(), z.string()).optional(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
}).passthrough();

/** validate_analysis: analysis_preview (POST /v1/analyses, validate_only: true). */
export const AnalysisPreviewOutputSchema = z.object({
  object: z.literal('analysis_preview'),
  query: z.record(z.string(), z.unknown()),
  parse_mode: z.enum(['llm', 'heuristic', 'client']),
  assessable: z.boolean().describe('False means the model cannot score this query form — rephrase as yes/no or count.'),
  video_duration_s: z.number().nullable(),
  estimated_seconds: z.number().int().nullable().describe('Null when the video duration is not yet known.'),
  estimated_cost_usd: z.number().nullable(),
}).passthrough();

const BatchPricingSchema = z.object({
  full_price_prompts: z.number().int(),
  discounted_prompts: z.number().int(),
  discount_pct: z.number().int(),
  estimated_total_seconds: z.number().int().nullable(),
  estimated_total_cost_usd: z.number().nullable(),
}).passthrough();

/** create_analysis_batch: analysis_batch (POST /v1/analyses/batch, 202). */
export const AnalysisBatchOutputSchema = z.object({
  object: z.literal('analysis_batch'),
  id: z.string(),
  video_id: z.string(),
  analyses: z.array(AnalysisOutputSchema),
  pricing: BatchPricingSchema,
}).passthrough();

/**
 * wait_for_analysis (privacy-audit F-1): the analysis resource is returned
 * UNMODIFIED under `analysis`, with retry guidance as a sibling — never merged
 * into the documented resource shape (the old `_mcp_note` field).
 */
export const WaitForAnalysisOutputSchema = z.object({
  analysis: AnalysisOutputSchema,
  retry: z.object({
    reason: z.literal('timeout'),
    note: z.string(),
  }).nullable().describe('Null when the analysis reached a terminal state. Set when the wait timed out — call wait_for_analysis or get_analysis again.'),
});

export const ModelsOutputSchema = z.object({
  object: z.literal('list'),
  data: z.array(z.object({
    id: z.string(),
    object: z.literal('model'),
    status: z.enum(['stable', 'preview', 'deprecated']),
    default: z.boolean(),
    capabilities: z.record(z.string(), z.unknown()),
    sunset_at: z.string().nullable(),
    created_at: z.string(),
  }).passthrough()),
  has_more: z.boolean(),
}).passthrough();

export const UsageOutputSchema = z.object({
  meters: z.array(z.object({
    meter: z.string(),
    unit: z.string(),
    balance: z.number().optional(),
    limit: z.number().nullable().optional(),
    used: z.number().optional(),
    resets_at: z.string().optional(),
  }).passthrough()).describe('Authoritative usage meters (credit_seconds balance, period meters).'),
}).passthrough();

/** get_credits: GET /v1/credits — balance + transaction ledger. */
export const CreditsOutputSchema = z.object({
  object: z.literal('credits'),
  balance_seconds: z.number().describe('Seconds of analysis remaining. The authoritative balance.'),
  grant_seconds: z.number().nullable(),
  used_seconds: z.number().nullable(),
  transactions: z.array(z.object({
    id: z.string(),
    kind: z.string().describe('e.g. signup_grant, analysis_debit, stream_debit, purchase.'),
    seconds_delta: z.number().describe('Signed: negative debits, positive credits.'),
    balance_after_seconds: z.number(),
    source_type: z.string().nullable(),
    source_id: z.string().nullable().describe('The analysis/stream id a debit came from.'),
    created_at: z.string(),
  }).passthrough()),
  has_more: z.boolean(),
}).passthrough();

export const TestFixtureOutputSchema = z.object({
  description: z.string().optional(),
  fixtures: z.array(z.object({
    name: z.string(),
    test_video_url: z.string(),
    test_prompt: z.string(),
    expected_answer: z.enum(['yes', 'no', 'indeterminate']),
    expected_confidence_min: z.number(),
    expected_detected_count_min: z.number().int().optional(),
    note: z.string().optional(),
  }).passthrough()).optional(),
}).passthrough();

/** Output schema per tool — single source of truth for index.ts registration. */
export const TOOL_OUTPUT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  create_video_from_url: VideoOutputSchema,
  create_analysis: AnalysisOutputSchema,
  validate_analysis: AnalysisPreviewOutputSchema,
  create_analysis_batch: AnalysisBatchOutputSchema,
  get_analysis: AnalysisOutputSchema,
  wait_for_analysis: WaitForAnalysisOutputSchema,
  list_models: ModelsOutputSchema,
  get_usage: UsageOutputSchema,
  get_credits: CreditsOutputSchema,
  get_test_fixture: TestFixtureOutputSchema,
};
