/**
 * Tool definitions for @primate-intelligence/mcp (design §5, PRI-438 P9).
 *
 * Tool descriptions and schemas mirror the OpenAPI document served at
 * GET /v1/openapi.json — the spec is the source of truth. v1.0 scope:
 *   create_video_from_url, create_analysis, get_analysis,
 *   wait_for_analysis, list_models, get_usage, get_test_fixture.
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
  handler: (args: z.objectOutputType<Shape, z.ZodTypeAny>) => Promise<unknown>;
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
      metadata: z.record(z.string()).optional().describe('Optional key-value metadata to attach.'),
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
      'The result contains answer (yes|no|indeterminate), confidence (0-1), and clip timestamps.',
    schema: {
      video_id: z.string().describe('The video to analyze (video_… id from create_video_from_url).'),
      prompt: z.string().max(2000).describe('Free-text question about the video, e.g. "Is there a person in this video?"'),
      model: z.string().optional().describe('Model id (see list_models). Defaults to the current default model.'),
      metadata: z.record(z.string()).optional().describe('Optional key-value metadata to attach.'),
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
    name: 'get_analysis',
    annotations: {
      title: 'Get analysis result',
      readOnlyHint: true,
      openWorldHint: false,
    },
    description:
      'Fetch an analysis by id (GET /v1/analyses/{id}). While running, shows live progress and queue_position. ' +
      'When status is "completed", result carries answer/confidence/clips.',
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
      openWorldHint: false,
    },
    description:
      'Block until an analysis reaches a terminal state (completed | failed | canceled), polling GET /v1/analyses/{id}. ' +
      'Returns the final analysis. Default timeout 120s (test-mode analyses complete in seconds).',
    schema: {
      analysis_id: z.string().describe('The analysis id (an_…).'),
      timeout_s: z.number().int().min(1).max(600).optional().describe('Max seconds to wait (default 120).'),
    },
    handler: async (args) => {
      const timeoutMs = (args.timeout_s ?? 120) * 1000;
      const deadline = Date.now() + timeoutMs;
      let analysis = await api<Analysis>('GET', `/v1/analyses/${args.analysis_id}`);
      while (!TERMINAL.has(analysis.status)) {
        if (Date.now() > deadline) {
          return {
            ...analysis,
            _mcp_note: `Timed out after ${args.timeout_s ?? 120}s — analysis is still ${analysis.status}. Call wait_for_analysis again or get_analysis later.`,
          };
        }
        await new Promise((r) => setTimeout(r, 2000));
        analysis = await api<Analysis>('GET', `/v1/analyses/${args.analysis_id}`);
      }
      return analysis;
    },
  },
  {
    name: 'list_models',
    annotations: {
      title: 'List analysis models',
      readOnlyHint: true,
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
      openWorldHint: false,
    },
    description:
      'Get credit balance and period usage meters for the current API key (GET /v1/usage). ' +
      'Use this after an insufficient_credits error to report the balance.',
    schema: {},
    handler: () => api('GET', '/v1/usage'),
  },
  {
    name: 'get_test_fixture',
    annotations: {
      title: 'Get test fixture',
      readOnlyHint: true,
      openWorldHint: false,
    },
    description:
      'Get the stable test fixture (GET /v1/test-fixture): a video URL + prompt + expected answer for verifying an ' +
      'integration end-to-end without burning quota. Test-mode (pv_test_) keys return deterministic canned results.',
    schema: {},
    handler: () => api('GET', '/v1/test-fixture'),
  },
];
