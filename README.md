# agy-mcp

MCP server for [Antigravity CLI](https://antigravity.google/docs/cli) (`agy`).

Expose Google's Antigravity agent (powered by Gemini) as an MCP tool for any MCP client — OpenClaw, Hermes, Claude Desktop, Cursor, or your own orchestrator.

## What it does

`agy-mcp` wraps the `agy` CLI and exposes it as a single MCP tool: `antigravity_code`.

- **One-shot execution**: Send a prompt, get a response
- **Session persistence**: Reuse the same `agy` conversation across multiple tool calls via `sessionId`
- **Any MCP client**: Works with anything that speaks the MCP protocol over stdio

## Install

```bash
# Install globally
npm install -g agy-mcp

# Or run directly with npx
npx -y agy-mcp@latest
```

## Prerequisites

1. **Antigravity CLI installed**:  
   Follow the [official docs](https://antigravity.google/docs/cli) or run:
   ```bash
   curl -fsSL https://antigravity.google/cli/install.sh | bash
   ```

2. **Authenticated**: Run `agy` once interactively to sign in with your Google account.

## Usage

### Standalone

```bash
agy-mcp
```

The server speaks JSON-RPC 2.0 over stdio. It exposes one tool: `antigravity_code`.

### With Claude Desktop / Cursor / any MCP client

Add to your MCP config:

```json
{
  "mcpServers": {
    "antigravity": {
      "command": "npx",
      "args": ["-y", "agy-mcp@latest"],
      "transport": "stdio"
    }
  }
}
```

### Tool Schema: `antigravity_code`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | ✅ | The natural language task |
| `workFolder` | string | ❌ | Absolute path to working directory |
| `sessionId` | string | ❌ | Reuse the same agy conversation across calls |

### Example Call

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "antigravity_code",
    "arguments": {
      "prompt": "Generate a Flutter onboarding screen design",
      "workFolder": "/Users/me/projects/myapp",
      "sessionId": "design-task-001"
    }
  }
}
```

## Session Persistence

Pass the same `sessionId` across multiple calls to resume the same `agy` conversation:

```json
// Call 1: Start a design task
{"prompt": "Design a splash screen...", "sessionId": "design-001"}

// Call 2: Iterate on the same design
{"prompt": "Make the background darker...", "sessionId": "design-001"}

// Call 3: Export assets
{"prompt": "Export all assets to assets/ folder", "sessionId": "design-001"}
```

Session mappings are stored in `~/.config/agy-mcp/sessions.json`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGY_CLI_PATH` | Absolute path to the `agy` binary (skip auto-discovery) |
| `AGY_CLI_NAME` | Custom binary name or path |
| `AGY_MCP_DEBUG` | Set to `true` for verbose stderr logging |
| `AGY_MCP_TIMEOUT_MS` | Command timeout in milliseconds (default: 600000 = 10min) |
| `AGY_MCP_SESSION_FILE` | Custom session mapping file path |

## Comparison: agy-mcp vs claude-code-mcp

| | agy-mcp | claude-code-mcp |
|---|---|---|
| **Backend** | Google Gemini (via Antigravity) | Anthropic Claude |
| **Strengths** | Design, image generation, web tools | Deep reasoning, complex refactoring |
| **Output format** | Plain text | JSON + text |
| **Session mode** | `--conversation=<id>` | `--resume=<id>` |
| **Permissions** | `--dangerously-skip-permissions` | `--dangerously-skip-permissions` |

Use both in the same MCP client for a **dual-agent comparison workflow**.

## Development

```bash
git clone https://github.com/Spark014/agy-mcp.git
cd agy-mcp
npm install
npm run dev    # Run with tsx (auto-reload)
npm run build  # Compile to dist/
npm test       # Run tests
```

## Why This Exists

The [claude-code-mcp](https://github.com/steipete/claude-code-mcp) project proved MCP servers for coding agents are useful. But it only covers Claude. `agy-mcp` adds Google's Antigravity/Gemini to the same ecosystem, enabling:

- **Dual-agent comparison**: Run the same prompt on Claude + Gemini, compare outputs
- **Specialized delegation**: Claude for code, Gemini for design/images
- **Redundancy**: If one provider is down, the other handles the task

## License

MIT

## Author

Raqeeb M. ([@Spark014](https://github.com/Spark014))

Built with ❤️ at [Kawn Labs](https://github.com/Kawn-Labs)
