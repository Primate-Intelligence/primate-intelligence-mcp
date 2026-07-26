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

describe('MCP tool surface (v1.0 scope, design §5)', () => {
  it('exposes exactly the seven v1.0 tools', async () => {
    const { TOOLS } = await import('./tools.js');
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      'create_analysis',
      'create_video_from_url',
      'get_analysis',
      'get_test_fixture',
      'get_usage',
      'list_models',
      'wait_for_analysis',
    ]);
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
    const out = (await tool.handler({ analysis_id: 'an_1', timeout_s: 30 } as never)) as { status: string };
    expect(out.status).toBe('completed');
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
