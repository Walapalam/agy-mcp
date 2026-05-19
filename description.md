# Default Tool Description for agy-mcp

Edit this file or set `AGY_MCP_DESCRIPTION_PATH` env var to point to your own description file.

## Tool: `antigravity_code`

Antigravity Code Agent: Your versatile AI assistant powered by Google Gemini.

### Capabilities

- **File operations**: Create, read, edit, list files, analyze images
- **Code**: Generate, analyze, refactor, fix bugs
- **Web**: Search and summarize content
- **Design**: Generate images, UI mockups, visual assets
- **Multi-step workflows**: Complex tasks with multiple stages

### Prompt Tips

1. Be concise and explicit for complex tasks.
2. For multi-line text, write to a temp file in the project root, use it, then delete it.
3. If you get a timeout, split the task into smaller steps.
4. If `workFolder` is set, use relative paths for files.
5. For image generation, save prompts to a file and use `promptFile` parameter.
6. Use `autoContinue` to resume the last session without tracking IDs.

### Session Management

- **sessionId**: Reuse the same agy conversation across calls
- **autoContinue**: Automatically continue the most recent conversation
- **promptFile**: Reference long prompts from files

### Workspace

When `workFolder` is set, all file operations are relative to that directory.

### Output

Responses are plain text. For structured data, ask the agent to format as JSON or YAML.
