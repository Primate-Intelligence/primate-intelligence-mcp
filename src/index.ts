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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS, describeError } from './tools.js';

export function buildServer(): McpServer {
  const server = new McpServer({
    name: 'primate-intelligence',
    version: '0.1.0',
  });

  for (const tool of TOOLS) {
    // 5-arg overload: (name, description, paramsSchema, annotations, cb) —
    // annotations carry the directory-required title + readOnlyHint/destructiveHint.
    server.tool(tool.name, tool.description, tool.schema, tool.annotations, async (args: Record<string, unknown>) => {
      try {
        const result = await tool.handler(args as never);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: describeError(e) }],
        };
      }
    });
  }
  return server;
}

async function main(): Promise<void> {
  // Fail fast with a helpful message when the env contract is unmet.
  if (!process.env.PRIMATE_API_KEY) {
    console.error(
      'PRIMATE_API_KEY is not set. Add it to the MCP server env, e.g.\n' +
        '  { "mcpServers": { "primate-intelligence": { "command": "npx", "args": ["@primate-intelligence/mcp"], "env": { "PRIMATE_API_KEY": "pv_…" } } } }\n' +
        'Get a free test key: curl -X POST https://api.primateintelligence.ai/v1/sandbox',
    );
    process.exit(1);
  }
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  console.error('primate-intelligence MCP server running (stdio)');
}

// Only run when executed directly (not when imported by tests).
const invokedDirectly = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts');
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
