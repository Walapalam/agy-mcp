#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type ServerResult,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as path from 'path';

const SERVER_VERSION = "1.0.0";

const debugMode = process.env.AGY_MCP_DEBUG === 'true';
const DEFAULT_AGY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function debugLog(message?: any, ...optionalParams: any[]): void {
  if (debugMode) {
    console.error(message, ...optionalParams);
  }
}

export function findAgyCli(): string {
  debugLog('[Debug] Finding agy CLI...');

  const cliPath = process.env.AGY_CLI_PATH;
  if (cliPath) {
    if (existsSync(cliPath)) {
      debugLog(`[Debug] Found agy at AGY_CLI_PATH: ${cliPath}`);
      return cliPath;
    }
    console.warn(`[Warning] AGY_CLI_PATH set to "${cliPath}" but file does not exist.`);
  }

  const customName = process.env.AGY_CLI_NAME;
  if (customName) {
    debugLog(`[Debug] Using custom name from AGY_CLI_NAME: ${customName}`);
    return customName;
  }

  const commonPaths = [
    join(homedir(), '.local', 'bin', 'agy'),
    join(homedir(), 'bin', 'agy'),
    '/usr/local/bin/agy',
    '/usr/bin/agy',
  ];
  for (const p of commonPaths) {
    if (existsSync(p)) {
      debugLog(`[Debug] Found agy at: ${p}`);
      return p;
    }
  }

  debugLog('[Debug] Falling back to "agy" in PATH');
  return 'agy';
}

interface AgyCodeArgs {
  prompt?: string;
  promptFile?: string;
  workFolder?: string;
  sessionId?: string;
  autoContinue?: boolean;
}

interface SessionEntry {
  agyConversationId: string;
  updatedAt: string;
}

const MAX_SESSIONS = 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_FILE =
  process.env.AGY_MCP_SESSION_FILE ||
  join(homedir(), '.config', 'agy-mcp', 'sessions.json');

let sessionMap: Map<string, SessionEntry> | null = null;

function ensureSessionMap(): Map<string, SessionEntry> {
  if (sessionMap) return sessionMap;
  sessionMap = new Map();
  try {
    if (existsSync(SESSION_FILE)) {
      const parsed = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as Record<string, SessionEntry>;
      sessionMap = new Map(Object.entries(parsed));
      cleanExpiredSessions();
    }
  } catch (error) {
    debugLog('[Debug] Failed to load session map:', error);
    sessionMap = new Map();
  }
  return sessionMap;
}

function saveSessionMap(): void {
  const map = ensureSessionMap();
  try {
    mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    writeFileSync(SESSION_FILE, JSON.stringify(Object.fromEntries(map), null, 2), {
      mode: 0o600,
    });
  } catch (error) {
    debugLog('[Debug] Failed to save session map:', error);
  }
}

function cleanExpiredSessions(): void {
  const map = ensureSessionMap();
  const now = Date.now();
  let changed = false;
  for (const [key, entry] of map) {
    if (now - new Date(entry.updatedAt).getTime() > SESSION_TTL_MS) {
      map.delete(key);
      changed = true;
    }
  }
  if (changed) saveSessionMap();
}

function getSessionMapping(parentSessionId: string): string | undefined {
  const map = ensureSessionMap();
  const entry = map.get(parentSessionId);
  if (!entry) return undefined;
  if (Date.now() - new Date(entry.updatedAt).getTime() > SESSION_TTL_MS) {
    map.delete(parentSessionId);
    saveSessionMap();
    return undefined;
  }
  return entry.agyConversationId;
}

function setSessionMapping(parentSessionId: string, agyConversationId: string): void {
  const map = ensureSessionMap();
  if (map.size >= MAX_SESSIONS) {
    const oldestKey = map.keys().next().value;
    if (oldestKey) map.delete(oldestKey);
  }
  map.set(parentSessionId, {
    agyConversationId,
    updatedAt: new Date().toISOString(),
  });
  saveSessionMap();
}

function parseConversationId(output: string): string | undefined {
  const match = output.match(/agy\s+--conversation=([a-f0-9-]{36})/i);
  return match?.[1];
}

export async function spawnAsync(
  command: string,
  args: string[],
  options?: { timeout?: number; cwd?: string }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    debugLog(`[Spawn] Running: ${command} ${args.join(' ')}`);

    const childProcess = spawn(command, args, {
      timeout: options?.timeout,
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    childProcess.stdout.on('data', (data) => { stdout += data.toString(); });
    childProcess.stderr.on('data', (data) => { stderr += data.toString(); });

    childProcess.on('error', (error: NodeJS.ErrnoException) => {
      let errorMessage = `Spawn error: ${error.message}`;
      if (error.path) errorMessage += ` | Path: ${error.path}`;
      if (error.syscall) errorMessage += ` | Syscall: ${error.syscall}`;
      errorMessage += `\nStderr: ${stderr.trim()}`;
      reject(new Error(errorMessage));
    });

    childProcess.on('close', (code) => {
      debugLog(`[Spawn] Exit code: ${code}`);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(
          `Command failed with exit code ${code}\nStderr: ${stderr.trim()}\nStdout: ${stdout.trim()}`
        ));
      }
    });
  });
}

export class AgyMcpServer {
  private server: Server;
  private agyCliPath: string;

  constructor() {
    this.agyCliPath = findAgyCli();
    console.error(`[Setup] Using agy CLI: ${this.agyCliPath}`);

    this.server = new Server(
      {
        name: 'agy_mcp',
        version: SERVER_VERSION,
      },
      {
        capabilities: { tools: {} },
      }
    );

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error('[Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'antigravity_code',
          description: `Antigravity Code Agent: Your versatile AI assistant powered by Google Gemini. Use \`workFolder\` for contextual execution.

• File ops: Create, read, edit, list files, analyze images
• Code: Generate, analyze, refactor, fix bugs
• Web search + summarise content
• Design: Generate images, UI mockups, visual assets
• Multi-step workflows

**Prompt tips**
1. Be concise and explicit for complex tasks.
2. For multi-line text, write to a temp file in the project root, use it, then delete it.
3. If you get a timeout, split the task into smaller steps.
4. If workFolder is set, use relative paths for files.
`,
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'The detailed natural language prompt for the agent to execute. Either prompt or promptFile is required.',
              },
              promptFile: {
                type: 'string',
                description: 'Path to a file containing the prompt. Useful for long prompts or image generation workflows. Either prompt or promptFile is required.',
              },
              workFolder: {
                type: 'string',
                description: 'The working directory for execution. Must be an absolute path.',
              },
              sessionId: {
                type: 'string',
                description: 'Parent session ID. When provided, repeated calls resume the same agy conversation.',
              },
              autoContinue: {
                type: 'boolean',
                description: 'When true, automatically continue the most recent agy conversation (equivalent to agy -c). Ignores sessionId.',
              },
            },
            required: [],
          },
        },
      ],
    }));

    const executionTimeoutMs = Number(process.env.AGY_MCP_TIMEOUT_MS) || DEFAULT_AGY_TIMEOUT_MS;

    this.server.setRequestHandler(CallToolRequestSchema, async (args): Promise<ServerResult> => {
      debugLog('[Debug] Handling CallToolRequest:', args);

      const toolName = args.params.name;
      if (toolName !== 'antigravity_code') {
        throw new McpError(ErrorCode.MethodNotFound, `Tool ${toolName} not found`);
      }

      const toolArguments = args.params.arguments;
      let prompt: string | undefined;

      // Handle promptFile
      if (toolArguments && typeof toolArguments === 'object' && 'promptFile' in toolArguments) {
        if (typeof toolArguments.promptFile === 'string') {
          const promptFilePath = pathResolve(toolArguments.promptFile);
          if (existsSync(promptFilePath)) {
            try {
              prompt = readFileSync(promptFilePath, 'utf8');
              debugLog(`[Debug] Read prompt from file: ${promptFilePath} (${prompt.length} chars)`);
            } catch (err) {
              throw new McpError(ErrorCode.InvalidParams, `Failed to read promptFile: ${promptFilePath}`);
            }
          } else {
            throw new McpError(ErrorCode.InvalidParams, `promptFile does not exist: ${promptFilePath}`);
          }
        } else {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid parameter: promptFile must be a string.');
        }
      }

      // Handle prompt (direct string)
      if (!prompt && toolArguments && typeof toolArguments === 'object' && 'prompt' in toolArguments) {
        if (typeof toolArguments.prompt === 'string') {
          prompt = toolArguments.prompt;
        } else {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid parameter: prompt must be a string.');
        }
      }

      if (!prompt) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required parameter: prompt or promptFile');
      }

      const sessionId = toolArguments?.sessionId;
      if (sessionId !== undefined && typeof sessionId !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid parameter: sessionId must be a string.');
      }

      const autoContinue = toolArguments?.autoContinue === true;

      let effectiveCwd = homedir();
      if (toolArguments?.workFolder && typeof toolArguments.workFolder === 'string') {
        const resolvedCwd = pathResolve(toolArguments.workFolder);
        if (existsSync(resolvedCwd)) {
          effectiveCwd = resolvedCwd;
          debugLog(`[Debug] Using workFolder: ${effectiveCwd}`);
        } else {
          debugLog(`[Warning] workFolder does not exist: ${resolvedCwd}. Using default.`);
        }
      } else {
        debugLog(`[Debug] No workFolder provided, using default: ${effectiveCwd}`);
      }

      try {
        const agyProcessArgs = [
          '--print',
          '--dangerously-skip-permissions',
        ];

        // Handle autoContinue (-c flag)
        if (autoContinue) {
          agyProcessArgs.push('--continue');
          debugLog('[Debug] Using auto-continue (--continue flag)');
        }

        // Handle sessionId-based session continuity (only if not autoContinue)
        if (!autoContinue) {
          const useSessionContinuity = typeof sessionId === 'string' && sessionId.length > 0;
          let existingConversationId: string | undefined;

          if (useSessionContinuity) {
            existingConversationId = getSessionMapping(sessionId);
            if (existingConversationId) {
              agyProcessArgs.push(`--conversation=${existingConversationId}`);
              debugLog(`[Debug] Resuming agy conversation: ${existingConversationId}`);
            }
          }
        }

        agyProcessArgs.push('--prompt', prompt);

        debugLog(`[Debug] Invoking agy: ${this.agyCliPath} ${agyProcessArgs.join(' ')}`);

        const { stdout, stderr } = await spawnAsync(
          this.agyCliPath,
          agyProcessArgs,
          { timeout: executionTimeoutMs, cwd: effectiveCwd }
        );

        debugLog('[Debug] agy stdout:', stdout.trim().slice(0, 500));
        if (stderr) {
          debugLog('[Debug] agy stderr:', stderr.trim().slice(0, 500));
        }

        const combinedOutput = stdout + '\n' + stderr;
        const conversationId = parseConversationId(combinedOutput);
        if (conversationId && !autoContinue && typeof sessionId === 'string' && sessionId.length > 0) {
          setSessionMapping(sessionId, conversationId);
          debugLog(`[Debug] Saved session mapping: ${sessionId} -> ${conversationId}`);
        }

        const content: { type: 'text'; text: string }[] = [{ type: 'text', text: stdout }];
        if (conversationId) {
          content.push({ type: 'text', text: `\n---\n_Session ID: ${conversationId}_` });
        }

        return { content };

      } catch (error: any) {
        debugLog('[Error] Error executing agy:', error);
        let errorMessage = error.message || 'Unknown error';
        if (error.stderr) errorMessage += `\nStderr: ${error.stderr}`;
        if (error.stdout) errorMessage += `\nStdout: ${error.stdout}`;

        if (error.signal === 'SIGTERM' || error.message?.includes('ETIMEDOUT')) {
          throw new McpError(
            ErrorCode.InternalError,
            `agy command timed out after ${executionTimeoutMs / 1000}s. Details: ${errorMessage}`
          );
        }
        throw new McpError(ErrorCode.InternalError, `agy execution failed: ${errorMessage}`);
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('agy MCP server running on stdio');
  }
}

export async function main(): Promise<void> {
  const server = new AgyMcpServer();
  await server.run();
}

const isMainModule = process.argv[1] !== undefined
  && pathResolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch(console.error);
}
