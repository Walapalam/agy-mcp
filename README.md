# agy-mcp

MCP server for [Antigravity CLI](https://antigravity.google/docs/cli) (`agy`).

Expose Google's Antigravity agent (powered by Gemini) as an MCP tool for any MCP client — OpenClaw, Hermes, Claude Desktop, Cursor, or your own orchestrator.

## What it does

`agy-mcp` wraps the `agy` CLI and exposes it as a single MCP tool: `antigravity_code`.

- **One-shot execution**: Send a prompt, get a response
- **Session persistence**: Reuse the same `agy` conversation across multiple tool calls via `sessionId`
- **Auto-continue**: Automatically resume the most recent `agy` conversation with `autoContinue: true`
- **Prompt files**: Reference long prompts from files via `promptFile` path
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
| `prompt` | string | ❌* | The natural language task (or use `promptFile`) |
| `promptFile` | string | ❌* | Path to a file containing the prompt. Useful for long prompts or image generation workflows |
| `workFolder` | string | ❌ | Absolute path to working directory |
| `sessionId` | string | ❌ | Reuse the same agy conversation across calls |
| `autoContinue` | boolean | ❌ | Continue the most recent agy conversation (equivalent to `agy -c`) |

\* *Either `prompt` or `promptFile` is required.*

### Example Calls

#### Simple one-shot

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "antigravity_code",
    "arguments": {
      "prompt": "Generate a Flutter onboarding screen design",
      "workFolder": "/Users/me/projects/myapp"
    }
  }
}
```

#### Using a prompt file (for long prompts or image generation)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "antigravity_code",
    "arguments": {
      "promptFile": "/Users/me/prompts/image-generation.txt",
      "workFolder": "/Users/me/projects/myapp"
    }
  }
}
```

#### Auto-continue last session (`agy -c`)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "antigravity_code",
    "arguments": {
      "prompt": "Iterate on the design — make the background darker",
      "workFolder": "/Users/me/projects/myapp",
      "autoContinue": true
    }
  }
}
```

#### Session persistence

```json
// Call 1: Start a design task
{"prompt": "Design a splash screen...", "sessionId": "design-001"}

// Call 2: Iterate on the same design
{"prompt": "Make the background darker...", "sessionId": "design-001"}

// Call 3: Export assets
{"prompt": "Export all assets to assets/ folder", "sessionId": "design-001"}
```

## Session Management

### Session Persistence (`sessionId`)

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

### Auto-Continue (`autoContinue`)

Set `autoContinue: true` to automatically resume the most recent `agy` conversation (equivalent to running `agy -c`):

```json
{
  "prompt": "Continue working on the design from last time",
  "autoContinue": true
}
```

This is useful when:
- You don't know or care about the specific session ID
- You want to pick up exactly where you left off
- You're iterating on the last task

**Note:** `autoContinue` takes precedence over `sessionId`. When `autoContinue` is `true`, `sessionId` is ignored.

### Prompt Files (`promptFile`)

For long prompts (e.g., detailed image generation descriptions), save the prompt to a file and reference it:

```bash
# Create a prompt file
cat > /tmp/image-prompt.txt << 'EOF'
Generate a mobile onboarding screen for an Islamic daily reflection app.
Use earthy tones, Islamic geometric patterns, and elegant Arabic calligraphy.
The screen should have:
- A large crescent moon and star icon at the top
- The app name "DeenScrolling" in elegant serif font
- A subtle geometric pattern background in deep teal (#0D4D4D)
- Two call-to-action buttons: "Get Started" and "Learn More"
- Soft ambient lighting from the bottom
EOF
```

Then reference it in the MCP call:

```json
{
  "promptFile": "/tmp/image-prompt.txt",
  "workFolder": "/Users/me/projects/myapp"
}
```

## Customizing the Tool Description

The `antigravity_code` tool description is loaded dynamically from a markdown file. This allows you to customize how the tool appears to your MCP client (Claude Desktop, OpenClaw, etc.).

### How it works

1. **Default**: The server looks for `description.md` in the project root
2. **Custom**: Set `AGY_MCP_DESCRIPTION_PATH` to point to your own description file

### Custom description file example

Create `my-description.md`:

```markdown
# My Custom Antigravity Agent

Specialized for mobile app development with Flutter and Dart.

### Expertise
- Flutter UI/UX design and implementation
- Dart code generation and refactoring
- Image generation for app assets and mockups
- State management with Riverpod

### Workflow
1. Always generate test files alongside implementation
2. Follow the project's existing architecture patterns
3. Use relative paths when workFolder is set
```

### Usage

```bash
# Set custom description via env var
AGY_MCP_DESCRIPTION_PATH=/path/to/my-description.md agy-mcp

# Or in MCP config
{
  "mcpServers": {
    "antigravity": {
      "command": "npx",
      "args": ["-y", "agy-mcp@latest"],
      "transport": "stdio",
      "env": {
        "AGY_MCP_DESCRIPTION_PATH": "/path/to/my-description.md"
      }
    }
  }
}
```

The description file is read once at server startup. Restart the server after editing.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGY_CLI_PATH` | Absolute path to the `agy` binary (skip auto-discovery) |
| `AGY_CLI_NAME` | Custom binary name or path |
| `AGY_MCP_DEBUG` | Set to `true` for verbose stderr logging |
| `AGY_MCP_TIMEOUT_MS` | Command timeout in milliseconds (default: 600000 = 10min) |
| `AGY_MCP_SESSION_FILE` | Custom session mapping file path |
| `AGY_MCP_DESCRIPTION_PATH` | Custom tool description markdown file path |

## Comparison: agy-mcp vs claude-code-mcp

| | agy-mcp | claude-code-mcp |
|---|---|---|
| **Backend** | Google Gemini (via Antigravity) | Anthropic Claude |
| **Strengths** | Design, image generation, web tools | Deep reasoning, complex refactoring |
| **Output format** | Plain text | JSON + text |
| **Session mode** | `--conversation=<id>` or `--continue` | `--resume=<id>` |
| **Permissions** | `--dangerously-skip-permissions` | `--dangerously-skip-permissions` |
| **Prompt files** | ✅ `promptFile` parameter | ❌ |
| **Auto-continue** | ✅ `autoContinue: true` (like `agy -c`) | ❌ |

Use both in the same MCP client for a **dual-agent comparison workflow**.

## Development

```bash
git clone https://github.com/Walapalam/agy-mcp.git
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

Raqeeb M. ([@Walapalam](https://github.com/Walapalam))

Built with ❤️ at [Kawn Labs](https://github.com/Kawn-Labs)
