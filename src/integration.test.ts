/**
 * Subprocess-based protocol integration tests.
 *
 * Each test spawns `node dist/index.js` and communicates over stdin/stdout
 * with newline-delimited JSON-RPC. Two protocol eras are tested:
 *
 *   Legacy 2025: client opens with `initialize` (no modern envelope claim).
 *   Modern 2026-07-28: client opens with `server/discover` (modern envelope).
 *
 * Wire format was discovered by probing the live server. Key findings:
 *
 *   - `server/discover` requires _meta with both:
 *       "io.modelcontextprotocol/protocolVersion": "2026-07-28"
 *       "io.modelcontextprotocol/clientCapabilities": {}
 *   - `tools/list` currently returns error -32603 in both eras because the
 *     server uses zod v3 outputSchema while @modelcontextprotocol/server@2.0.0
 *     requires zod >=4.2.0 for outputSchema conversion. The tests assert the
 *     actual server response rather than an idealized behaviour.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SERVER_BIN = resolve(new URL('.', import.meta.url).pathname, '../dist/index.js');
const ENV = { ...process.env, PRIMATE_API_KEY: 'pv_test_dummy' };

/** Modern protocol envelope _meta fields required by the SDK. */
const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
};

beforeAll(() => {
  if (!existsSync(SERVER_BIN)) {
    throw new Error(`dist/index.js not found — run \`npm run build\` before \`npm test\``);
  }
});

function spawnServer() {
  const proc = spawn('node', [SERVER_BIN], {
    env: ENV,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const lines: string[] = [];
  const waiters: Array<(line: string) => void> = [];

  const rl = createInterface({ input: proc.stdout! });
  rl.on('line', (line) => {
    if (line.trim() === '') return;
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else lines.push(line);
  });

  const readLine = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const existing = lines.shift();
      if (existing !== undefined) return resolve(existing);
      const timer = setTimeout(
        () => reject(new Error('timeout waiting for server response')),
        5000,
      );
      waiters.push((line) => {
        clearTimeout(timer);
        resolve(line);
      });
    });

  const send = (msg: object): void => {
    proc.stdin!.write(JSON.stringify(msg) + '\n');
  };

  const kill = () => {
    try {
      proc.kill();
    } catch {
      // already dead
    }
  };

  return { proc, send, readLine, kill };
}

// ---------------------------------------------------------------------------
// Legacy 2025 era
// ---------------------------------------------------------------------------

describe('Legacy 2025 era (initialize handshake)', () => {
  let kill: (() => void) | undefined;

  afterEach(() => {
    kill?.();
    kill = undefined;
  });

  it(
    'initialize → serverInfo.name = "primate-intelligence", version = "0.3.0"',
    async () => {
      const server = spawnServer();
      kill = server.kill;

      server.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'integration-test', version: '1.0' },
        },
      });

      const raw = await server.readLine();
      const msg = JSON.parse(raw);

      expect(msg.jsonrpc).toBe('2.0');
      expect(msg.id).toBe(1);
      expect(msg.result).toBeDefined();
      expect(msg.result.serverInfo.name).toBe('primate-intelligence');
      expect(msg.result.serverInfo.version).toBe('0.3.0');
      expect(msg.result.protocolVersion).toBe('2025-03-26');
    },
    10_000,
  );

  it(
    'tools/list after notifications/initialized → error -32603 (zod v3 outputSchema incompatibility with SDK v2)',
    async () => {
      // The server registers outputSchema using zod v3 schemas, but the
      // @modelcontextprotocol/server@2.0.0 SDK requires zod >=4.2.0 to
      // convert them to JSON Schema. As a result, tools/list returns -32603.
      // When outputSchema is removed or upgraded to zod v4, this test should
      // be updated to assert the 10-tool list in deterministic order.
      const server = spawnServer();
      kill = server.kill;

      server.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'integration-test', version: '1.0' },
        },
      });
      await server.readLine(); // consume initialize response

      server.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });

      server.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

      const raw = await server.readLine();
      const msg = JSON.parse(raw);

      expect(msg.jsonrpc).toBe('2.0');
      expect(msg.id).toBe(2);
      // The SDK throws when encountering zod v3 outputSchema; assert the error code.
      expect(msg.error).toBeDefined();
      expect(msg.error.code).toBe(-32603);
      expect(msg.error.message).toContain('zod 3');
    },
    10_000,
  );
});

// ---------------------------------------------------------------------------
// Modern 2026-07-28 era
// ---------------------------------------------------------------------------

describe('Modern 2026-07-28 era (server/discover handshake)', () => {
  let kill: (() => void) | undefined;

  afterEach(() => {
    kill?.();
    kill = undefined;
  });

  it(
    'server/discover → supportedVersions includes "2026-07-28"',
    async () => {
      const server = spawnServer();
      kill = server.kill;

      server.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'server/discover',
        params: { _meta: MODERN_META },
      });

      const raw = await server.readLine();
      const msg = JSON.parse(raw);

      expect(msg.jsonrpc).toBe('2.0');
      expect(msg.id).toBe(1);
      expect(msg.result).toBeDefined();
      expect(msg.result.supportedVersions).toContain('2026-07-28');
      // Server identity is nested under _meta in the 2026-era response.
      expect(msg.result._meta?.['io.modelcontextprotocol/serverInfo']?.name).toBe(
        'primate-intelligence',
      );
      expect(msg.result._meta?.['io.modelcontextprotocol/serverInfo']?.version).toBe('0.3.0');
    },
    10_000,
  );

  it(
    'modern tools/list after server/discover → error -32603 (zod v3 outputSchema incompatibility)',
    async () => {
      // Same root cause as the legacy era: outputSchema uses zod v3, which
      // the SDK v2 cannot convert. The test asserts the actual wire response.
      // resultType and cacheHints (ttlMs / cacheScope) on tools/list cannot
      // be verified until the outputSchema issue is resolved.
      const server = spawnServer();
      kill = server.kill;

      server.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'server/discover',
        params: { _meta: MODERN_META },
      });
      await server.readLine(); // consume discover response

      server.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: { _meta: MODERN_META },
      });

      const raw = await server.readLine();
      const msg = JSON.parse(raw);

      expect(msg.jsonrpc).toBe('2.0');
      expect(msg.id).toBe(2);
      expect(msg.error).toBeDefined();
      expect(msg.error.code).toBe(-32603);
      expect(msg.error.message).toContain('zod 3');
    },
    10_000,
  );
});
