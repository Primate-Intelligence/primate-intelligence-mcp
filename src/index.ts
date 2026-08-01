/**
 * @primate-intelligence/mcp — MCP server for the Primate Vision API.
 *
 *   npx @primate-intelligence/mcp        (stdio transport)
 *
 * Env:
 *   PRIMATE_API_KEY   — required. Never passed as a tool argument (§5.3).
 *   PRIMATE_BASE_URL  — optional override (default https://api.primateintelligence.ai).
 *
 * Docs: https://primateintelligence.ai/docs/agents
 */
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { TOOLS, describeError } from './tools.js';
import { TOOL_OUTPUT_SCHEMAS } from './schemas.js';

export const MCP_SERVER_VERSION = '0.3.0';

export function buildServer(): McpServer {
  const server = new McpServer(
    {
      name: 'primate-intelligence',
      version: MCP_SERVER_VERSION,
    },
    {
      // Cache hints: 2026-07-28 era only — SDK gates these from 2025-era responses.
      // ttlMs: 1 hour; cacheScope: 'private' (single API key per stdio instance).
      cacheHints: {
        'tools/list': { ttlMs: 3_600_000, cacheScope: 'private' },
      },
    },
  );

  for (const tool of TOOLS) {
    // Cast config to `never` to bridge zod-v3 Standard Schema vs. v2 SDK types.
    const handler = async (args: Record<string, unknown>) => {
      try {
        const result = await tool.handler(args as never);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (e) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: describeError(e) }],
        };
      }
    };
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        // v2 requires Standard Schema; wrap raw ZodRawShape in z.object().
        inputSchema: z.object(tool.schema),
        outputSchema: TOOL_OUTPUT_SCHEMAS[tool.name],
        annotations: tool.annotations,
      } as never,
      handler as never,
    );
  }
  return server;
}

async function main(): Promise<void> {
  if (!process.env.PRIMATE_API_KEY) {
    console.error(
      'PRIMATE_API_KEY is not set. Add it to the MCP server env, e.g.\n' +
        '  { "mcpServers": { "primate-intelligence": { "command": "npx", "args": ["@primate-intelligence/mcp"], "env": { "PRIMATE_API_KEY": "pv_…" } } } }\n' +
        'Get a free test key: curl -X POST https://api.primateintelligence.ai/v1/sandbox',
    );
    process.exit(1);
  }
  console.error('primate-intelligence MCP server running (stdio)');
  // serveStdio calls buildServer() once per connection and negotiates era automatically.
  // Default mode serves 2026-07-28 AND falls back to legacy 2025 initialize handshake.
  const _handle = serveStdio(() => buildServer());
}

// Only run when executed directly (not when imported by tests).
const invokedDirectly = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts');
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
