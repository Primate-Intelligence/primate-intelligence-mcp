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
import { TOOL_OUTPUT_SCHEMAS } from './schemas.js';

export const MCP_SERVER_VERSION = '0.2.0';

export function buildServer(): McpServer {
  const server = new McpServer({
    name: 'primate-intelligence',
    version: MCP_SERVER_VERSION,
  });

  for (const tool of TOOLS) {
    // registerTool (MCP spec 2025-06-18+): declares inputSchema AND
    // outputSchema; results carry structuredContent conforming to it (the SDK
    // validates every non-error result at runtime). annotations carry the
    // directory-required title + readOnlyHint/destructiveHint.
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema,
        outputSchema: TOOL_OUTPUT_SCHEMAS[tool.name],
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>) => {
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
      },
    );
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
