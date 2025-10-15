# Headless Claude Documentation

This document captures the complete headless mode documentation for Claude Code CLI, used for reference when designing and implementing integration tests for the Iris MCP server.

## Overview

The headless mode allows running Claude Code programmatically from command line scripts and automation tools without any interactive UI.

## Basic Usage

The primary command-line interface to Claude Code is the `claude` command. Use the `--print` (or `-p`) flag to run in non-interactive mode and print the final result:

```bash
claude -p "Stage my changes and write a set of commits for them" \
  --allowedTools "Bash,Read" \
  --permission-mode acceptEdits
```

## Configuration Options

Headless mode leverages all the CLI options available in Claude Code. Here are the key ones for automation and scripting:

| Flag | Description | Example |
|------|-------------|---------|
| `--print`, `-p` | Run in non-interactive mode | `claude -p "query"` |
| `--output-format` | Specify output format (`text`, `json`, `stream-json`) | `claude -p --output-format json` |
| `--input-format` | Specify input format (`text`, `stream-json`) | `claude -p --input-format stream-json` |
| `--resume`, `-r` | Resume a conversation by session ID | `claude --resume abc123` |
| `--continue`, `-c` | Continue the most recent conversation | `claude --continue` |
| `--verbose` | Enable verbose logging | `claude --verbose` |
| `--append-system-prompt` | Append to system prompt (only with `--print`) | `claude --append-system-prompt "Custom instruction"` |
| `--allowedTools` | Space-separated list of allowed tools, or string of comma-separated list of allowed tools | `claude --allowedTools mcp__slack mcp__filesystem` or `claude --allowedTools "Bash(npm install),mcp__filesystem"` |
| `--disallowedTools` | Space-separated list of denied tools, or string of comma-separated list of denied tools | `claude --disallowedTools mcp__splunk mcp__github` or `claude --disallowedTools "Bash(git commit),mcp__github"` |
| `--mcp-config` | Load MCP servers from a JSON file | `claude --mcp-config servers.json` |
| `--permission-prompt-tool` | MCP tool for handling permission prompts (only with `--print`) | `claude --permission-prompt-tool mcp__auth__prompt` |
| `--dangerously-skip-permissions` | Skip all permission prompts (dangerous!) | `claude --dangerously-skip-permissions` |

## statistics

Context Usage Information
While you can't use /context in headless mode, the final JSON result message in streaming mode includes metrics like total_cost_usd, duration_ms, and num_turns Headless mode - Claude Docs, which provides some usage information - though not the detailed breakdown that /context offers in interactive mode.

## Multi-turn Conversations

For multi-turn conversations, you can resume conversations or continue from the most recent session:

```bash
# Continue the most recent conversation
claude --continue "Now refactor this for better performance"

# Resume a specific conversation by session ID
claude --resume 550e8400-e29b-41d4-a716-446655440000 "Update the tests"

# Resume in non-interactive mode
claude --resume 550e8400-e29b-41d4-a716-446655440000 "Fix all linting issues" --no-interactive
```

## Output Formats

### Text Output (Default)

```bash
claude -p "Explain file src/components/Header.tsx"
# Output: This is a React component showing...
```

### JSON Output

Returns structured data including metadata:

```bash
claude -p "How does the data layer work?" --output-format json
```

Response format:
```json
{
  "type": "result",
  "subtype": "success",
  "total_cost_usd": 0.003,
  "is_error": false,
  "duration_ms": 1234,
  "duration_api_ms": 800,
  "num_turns": 6,
  "result": "The response text here...",
  "session_id": "abc123"
}
```

### Streaming JSON Output

Streams each message as it is received:

```bash
claude -p "Build an application" --output-format stream-json
```

Each conversation begins with an initial `init` system message, followed by a list of user and assistant messages, followed by a final `result` system message with stats. Each message is emitted as a separate JSON object.

#### Stream-JSON Message Types

1. **System/Init Message** (first message in stream):
```json
{
  "type": "system",
  "subtype": "init",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "cwd": "/path/to/project",
  "tools": ["Task", "Bash", "Read", "Write", ...],
  "mcp_servers": [{"name": "server1", "status": "connected"}],
  "model": "claude-sonnet-4-5-20250929"
}
```

2. **User Messages** (echo of sent message):
```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "Explain this code"
      }
    ]
  },
  "session_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

3. **Streaming Events** (real-time updates as Claude responds):
```json
{
  "type": "stream_event",
  "event": {
    "type": "message_start",
    "message": { /* initial message structure */ }
  },
  "session_id": "550e8400-e29b-41d4-a716-446655440000"
}

{
  "type": "stream_event",
  "event": {
    "type": "content_block_delta",
    "index": 0,
    "delta": {
      "type": "text_delta",
      "text": "partial text chunk"
    }
  },
  "session_id": "550e8400-e29b-41d4-a716-446655440000"
}

{
  "type": "stream_event",
  "event": {
    "type": "message_stop"
  },
  "session_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

4. **Assistant Messages** (complete message after streaming):
```json
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "This code implements..."
      }
    ],
    "stop_reason": "end_turn",
    "tool_calls": []
  },
  "session_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

5. **Result Message** (final message in stream):
```json
{
  "type": "result",
  "subtype": "success",
  "total_cost_usd": 0.003,
  "is_error": false,
  "duration_ms": 1234,
  "duration_api_ms": 800,
  "num_turns": 6,
  "session_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Input Formats

### Text Input (Default)

```bash
# Direct argument
claude -p "Explain this code"

# From stdin
echo "Explain this code" | claude -p
```

### Streaming JSON Input

A stream of messages provided via `stdin` where each message represents a user turn. This allows multiple turns of a conversation without re-launching the `claude` binary and allows providing guidance to the model while it is processing a request.

Each message is a JSON 'User message' object, following the same format as the output message schema. Messages are formatted using the jsonl format where each line of input is a complete JSON object. Streaming JSON input requires `-p` and `--output-format stream-json`.

```bash
echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Explain this code"}]}}' | claude -p --output-format=stream-json --input-format=stream-json --verbose
```

## Implementation Notes for Iris MCP

### Key Points for Testing

1. **Process Spawning Arguments**:
   - Must use `--print` for headless mode
   - Must use `--verbose` to get stream-json output
   - Use `--dangerously-skip-permissions` for tests to avoid interactive prompts
   - Use `--input-format stream-json` and `--output-format stream-json` for bidirectional JSON communication

2. **Critical Discovery - Init Message Timing**:
   - **Claude does NOT send `init` message automatically on process spawn**
   - The `init` message is ONLY sent AFTER Claude receives the first message on stdin
   - You MUST send a dummy message (e.g., "ping") during spawn to trigger initialization
   - Only after receiving init can you consider the process ready

3. **Message Flow**:
   - Send: Write JSON line to process stdin
   - Receive: Parse JSON lines from process stdout
   - First message must be sent to trigger `init` response
   - Last message received is always `result` type
   - Actual responses are in `assistant` type messages (NOT `stream_event`)

4. **Stream-JSON Format Clarification**:
   - `--output-format stream-json` outputs NDJSON (newline-delimited JSON)
   - Each complete message is a separate JSON object
   - There are NO `stream_event` messages with `content_block_delta`
   - Responses come as complete `assistant` messages
   - Extract text from `message.content[0].text` in assistant messages

3. **Error Handling**:
   - Check `is_error` field in result message
   - Monitor stderr for debug information (when `--verbose` is used)
   - Process exit codes indicate failures

4. **Timing Considerations**:
   - Initial spawn + first response: ~13-15 seconds
   - Subsequent messages: 2-5 seconds
   - Set test timeouts accordingly (15s global is minimum)

### Example Test Communication

```javascript
// Spawn process
const args = [
  '--print',
  '--verbose',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--dangerously-skip-permissions'
];
const process = spawn('claude', args, { cwd: teamPath });

// Send message
const userMessage = {
  type: 'user',
  message: {
    role: 'user',
    content: [
      { type: 'text', text: 'Hello, Claude!' }
    ]
  }
};
process.stdin.write(JSON.stringify(userMessage) + '\n');

// Parse responses
let initReceived = false;
let responses = [];

process.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(line => line.trim());

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);

      if (msg.type === 'init') {
        initReceived = true;
        sessionId = msg.session_id;
      } else if (msg.type === 'assistant') {
        responses.push(msg.message.content[0].text);
      } else if (msg.type === 'result') {
        // Conversation complete
        if (msg.is_error) {
          throw new Error('Claude returned error');
        }
      }
    } catch (e) {
      // Not JSON, might be debug output
    }
  }
});
```

## Best Practices

1. **Use JSON output format** for programmatic parsing of responses:
```bash
result=$(claude -p "Generate code" --output-format json)
code=$(echo "$result" | jq -r '.result')
cost=$(echo "$result" | jq -r '.cost_usd')
```

2. **Handle errors gracefully** - check exit codes and stderr:
```bash
if ! claude -p "$prompt" 2>error.log; then
    echo "Error occurred:" >&2
    cat error.log >&2
    exit 1
fi
```

3. **Use session management** for maintaining context in multi-turn conversations

4. **Consider timeouts** for long-running operations:
```bash
timeout 300 claude -p "$complex_prompt" || echo "Timed out after 5 minutes"
```

5. **Respect rate limits** when making multiple requests by adding delays between calls

## Testing Implications

For Iris MCP integration tests:

1. **Mock Mode**: Consider creating a mock Claude process that mimics the stream-json protocol for faster tests
2. **Real Mode**: When testing with actual Claude CLI, expect 15+ second timeouts for initial responses
3. **Process Pool**: Reuse processes across tests to avoid spawn overhead
4. **Cleanup**: Always terminate processes in afterEach hooks
5. **Logging**: Capture stderr for debugging test failures

## More Notes
Based on my search, here are all the message types that Claude Code returns when using --output-format stream-json:
Main Message Types
Each conversation begins with an initial init system message, followed by a list of user and assistant messages, followed by a final result system message with stats, with each message emitted as a separate JSON object Headless mode - Claude Docs.
1. system (with subtype init)
The initial session initialization message:
json{
  "type": "system",
  "subtype": "init",
  "session_id": "...",
  "tools": [...]
}
2. user
User messages in the conversation:
json{
  "type": "user",
  "message": {
    "role": "user",
    "content": [...]
  }
}
3. assistant
Assistant (Claude's) responses:
json{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "content": [
      {"type": "text", "text": "..."},
      // or
      {"type": "tool_use", "id": "...", "name": "...", "input": {...}}
    ]
  }
}
4. tool_use (within assistant messages)
When Claude invokes a tool:
json{
  "type": "tool_use",
  "name": "Bash",
  "input": {"command": "ls -la"}
}
5. tool_result (within user messages)
Results from tool execution:
json{
  "type": "tool_result",
  "tool_use_id": "...",
  "content": "..."
}
6. result
The final message containing session statistics Headless mode - Claude Docs:
json{
  "type": "result",
  "subtype": "success",
  "total_cost_usd": 0.003,
  "is_error": false,
  "duration_ms": 1234,
  "duration_api_ms": 800,
  "num_turns": 6,
  "result": "The response text here...",
  "session_id": "abc123"
}
Message Flow Example
A typical conversation produces this sequence Missing Final Result Event in Streaming JSON Output with sdk · Issue #1920 · anthropics/claude-code:
json{"type":"system","subtype":"init","session_id":"...","tools":[...]}
{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"...","name":"TodoWrite",...}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"...","content":"..."}]}}
{"type":"result","subtype":"success",...}
Usage
This format is perfect for:

Programmatic processing with jq or other JSON tools
Multi-turn conversations via stdin/stdout
Real-time monitoring of Claude's actions
Building automation pipelines

The stream-json format uses JSONL (newline-delimited JSON), where each line is a complete, parseable JSON object!
