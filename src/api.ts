/**
 * Minimal API client for the MCP server.
 *
 * SECURITY (design §5.3 / §18.1): the API key is read from the
 * PRIMATE_API_KEY environment variable ONLY. It is never accepted as a
 * tool argument — that would land secret keys in agent transcripts.
 */

export const BASE_URL = (process.env.PRIMATE_BASE_URL ?? 'https://api.primateintelligence.ai').replace(/\/$/, '');

export function apiKey(): string {
  const key = process.env.PRIMATE_API_KEY;
  if (!key) {
    throw new Error(
      'PRIMATE_API_KEY is not set. Set it in the MCP server environment (never pass keys as tool arguments). ' +
        'Get a free test key: curl -X POST https://api.primateintelligence.ai/v1/sandbox',
    );
  }
  return key;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  docs_url?: string;
  request_id?: string;
  param?: string | null;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: ApiErrorBody) {
    super(`${body.code}: ${body.message}`);
  }
}

export async function api<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'User-Agent': 'primate-intelligence-mcp/0.1.0',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let err: ApiErrorBody = { code: 'internal_error', message: `HTTP ${res.status}` };
    try {
      err = ((await res.json()) as { error: ApiErrorBody }).error ?? err;
    } catch {
      /* non-JSON */
    }
    throw new ApiError(res.status, err);
  }
  return (await res.json()) as T;
}
