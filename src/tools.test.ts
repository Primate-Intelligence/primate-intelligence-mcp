import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  process.env.PRIMATE_API_KEY = 'pv_test_mcp';
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('MCP tool surface (v0.2 scope, design §5)', () => {
  it('exposes exactly the ten v0.2 tools', async () => {
    const { TOOLS } = await import('./tools.js');
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      'create_analysis',
      'create_analysis_batch',
      'create_video_from_url',
      'get_analysis',
      'get_credits',
      'get_test_fixture',
      'get_usage',
      'list_models',
      'validate_analysis',
      'wait_for_analysis',
    ]);
  });

  it('every tool has an outputSchema (MCP structuredContent contract)', async () => {
    const { TOOLS } = await import('./tools.js');
    const { TOOL_OUTPUT_SCHEMAS } = await import('./schemas.js');
    for (const tool of TOOLS) {
      expect(TOOL_OUTPUT_SCHEMAS[tool.name], `${tool.name} must declare an outputSchema`).toBeDefined();
    }
    expect(Object.keys(TOOL_OUTPUT_SCHEMAS).sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });

  it('read-only tools carry destructiveHint: false (directory requirement)', async () => {
    const { TOOLS } = await import('./tools.js');
    for (const tool of TOOLS) {
      if (tool.annotations.readOnlyHint) {
        expect(tool.annotations.destructiveHint, `${tool.name} readOnly tool must set destructiveHint: false`).toBe(false);
      }
    }
  });

  it('validate_analysis sends validate_only: true and never creates a job', async () => {
    const seen: { body?: Record<string, unknown> } = {};
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      seen.body = JSON.parse(String(init?.body));
      return jsonResponse(200, {
        object: 'analysis_preview',
        query: {},
        parse_mode: 'llm',
        assessable: true,
        video_duration_s: 22.967,
        estimated_seconds: 23,
        estimated_cost_usd: 0.23,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { TOOLS } = await import('./tools.js');
    const tool = TOOLS.find((t) => t.name === 'validate_analysis')!;
    const out = (await tool.handler({ video_id: 'video_1', prompt: 'p?' } as never)) as { object: string };
    expect(seen.body!.validate_only).toBe(true);
    expect(out.object).toBe('analysis_preview');
  });

  it('create_analysis_batch posts prompts array to /v1/analyses/batch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(202, {
      object: 'analysis_batch', id: 'ab_1', video_id: 'video_1', analyses: [],
      pricing: { full_price_prompts: 1, discounted_prompts: 1, discount_pct: 50, estimated_total_seconds: null, estimated_total_cost_usd: null },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { TOOLS } = await import('./tools.js');
    const tool = TOOLS.find((t) => t.name === 'create_analysis_batch')!;
    const out = (await tool.handler({ video_id: 'video_1', prompts: ['a?', 'b?'] } as never)) as { object: string };
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/analyses/batch');
    expect(out.object).toBe('analysis_batch');
  });

  it('get_credits hits /v1/credits with pagination params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
      object: 'credits', balance_seconds: 6000, grant_seconds: 6000, used_seconds: 0, transactions: [], has_more: false,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { TOOLS } = await import('./tools.js');
    const tool = TOOLS.find((t) => t.name === 'get_credits')!;
    const out = (await tool.handler({ limit: 5 } as never)) as { object: string };
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/credits?limit=5');
    expect(out.object).toBe('credits');
  });

  it('NO tool accepts an api key argument (§5.3 security contract)', async () => {
    const { TOOLS } = await import('./tools.js');
    for (const tool of TOOLS) {
      const keys = Object.keys(tool.schema).map((k) => k.toLowerCase());
      for (const k of keys) {
        expect(k, `${tool.name}.${k} must not be a credential argument`).not.toMatch(/key|token|secret|auth/);
      }
    }
  });

  it('create_video_from_url posts to /v1/videos with Bearer auth from env', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'video_1', object: 'video', status: 'processing' }));
    vi.stubGlobal('fetch', fetchMock);
    const { TOOLS } = await import('./tools.js');
    const tool = TOOLS.find((t) => t.name === 'create_video_from_url')!;
    const out = (await tool.handler({ url: 'https://example.com/v.mp4' } as never)) as { id: string };
    expect(out.id).toBe('video_1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/v1/videos');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer pv_test_mcp');
  });

  it('wait_for_analysis polls to terminal state', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: 'an_1', status: 'analyzing' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'an_1', status: 'completed', result: { answer: 'yes' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { TOOLS } = await import('./tools.js');
    const tool = TOOLS.find((t) => t.name === 'wait_for_analysis')!;
    const out = (await tool.handler({ analysis_id: 'an_1', timeout_s: 30 } as never)) as {
      analysis: { status: string };
      retry: unknown;
    };
    expect(out.analysis.status).toBe('completed');
    expect(out.retry).toBeNull();
    expect(out).not.toHaveProperty('_mcp_note');
  }, 15_000);

  it('API errors surface code + docs_url for agent self-correction', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(402, {
        error: {
          code: 'insufficient_credits',
          message: 'Insufficient credits.',
          docs_url: 'https://primateintelligence.ai/docs/errors#insufficient_credits',
          request_id: 'req_x',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { TOOLS, describeError } = await import('./tools.js');
    const tool = TOOLS.find((t) => t.name === 'create_analysis')!;
    try {
      await tool.handler({ video_id: 'video_1', prompt: 'p' } as never);
      expect.unreachable();
    } catch (e) {
      const msg = describeError(e);
      expect(msg).toContain('insufficient_credits');
      expect(msg).toContain('#insufficient_credits');
      expect(msg).toContain('req_x');
    }
  });
});
