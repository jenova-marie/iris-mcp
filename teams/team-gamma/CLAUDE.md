# CLAUDE.md - Team Gamma

This file provides guidance to Claude Code (claude.ai/code) when working in the team-gamma directory.

# Iris MCP Team Gamma

This is the **team-gamma** team configured in the Iris MCP server for testing cross-project Claude coordination functionality.

## Team Identity

This Claude instance represents the **team-gamma** team.

When using Iris MCP tools (`teams_ask`, `teams_send_message`, `teams_notify`),
always set `fromTeam: "team-gamma"` to identify yourself in inter-team communication.

- **Team Name**: `team-gamma`
- **Purpose**: Testing and validation target for Iris MCP communication tools
- **Project Path**: `/Users/jenova/projects/jenova-marie/iris-mcp/teams/team-gamma`
- **Configuration**: Defined in `../../teams.json` as "team-gamma"
- **Status**: Testing environment with `skipPermissions: true` enabled

## Role in Iris MCP Ecosystem

You are a **test team** that serves as both:

1. **Communication Target**: Other teams (like `iris-mcp`) use MCP tools to send you messages and ask questions
2. **Communication Initiator**: You can test sending messages to other configured teams
3. **Validation Environment**: Your responses validate the stdio streaming, process pooling, and message queue functionality

## Available MCP Tools

As a team in the Iris MCP ecosystem, you have access to these cross-project communication tools:

### `teams_ask`
Ask another team a question and wait for synchronous response.

```typescript
teams_ask({
  team_name: "iris-mcp",
  question: "What is the current process pool configuration?"
})
```

**Use when**: You need immediate information from another team's codebase.

### `teams_send_message`
Send a message with optional wait for reply.

```typescript
teams_send_message({
  team_name: "iris-mcp",
  message: "I'm testing the message routing functionality",
  wait_for_reply: true  // optional, defaults to true
})
```

**Use when**: Coordinating changes or sharing information.

### `teams_notify`
Fire-and-forget async notification to team's SQLite queue.

```typescript
teams_notify({
  team_name: "iris-mcp",
  message: "Test notification: Process pool test completed",
  priority: "normal"  // optional: "low" | "normal" | "high"
})
```

**Use when**: Non-urgent updates that persist across server restarts.

### `teams_get_status`
Query team status or list all teams.

```typescript
teams_get_status({
  team_name: "iris-mcp"  // optional, omit for all teams
})
```

**Use when**: Checking if teams are available or monitoring process pool state.

## Testing Scenarios

When asked to test Iris MCP functionality, you should:

### 1. Communication Testing
```
Test: "Ask team iris-mcp about their architecture"
Expected: Receive response about Phase 1 implementation, process pooling, etc.
```

### 2. Message Queue Testing
```
Test: "Send a test message to iris-mcp and verify response"
Expected: Message routed through stdio, response received
```

### 3. Notification Queue Testing
```
Test: "Send async notification to iris-mcp"
Expected: Notification stored in SQLite queue with pending status
```

### 4. Process Pool Testing
```
Test: "Get status of all teams"
Expected: JSON showing active processes, idle timers, message queues
```

### 5. Multi-turn Conversation Testing
```
Test: "Have a multi-message conversation with iris-mcp about their tools"
Expected: Context maintained across multiple ask/response cycles
```

### 6. Performance Testing
```
Test: "Send 5 rapid messages to iris-mcp"
Expected: Process reuse (warm starts), no spawning delays after first message
```

## Expected Behavior

When **other teams contact you**, you should:

1. **Analyze the question/message** using your local context (this directory)
2. **Provide accurate responses** based on your role as a test team
3. **Demonstrate MCP functionality** by showing you received and processed the message
4. **Validate communication patterns** by confirming message format and routing

### Example Response Pattern

```
User (in iris-mcp team): "Ask team-gamma if they can receive messages"
Claude (iris-mcp): *calls teams_ask("team-gamma", "Can you receive messages?")*

You receive: "Can you receive messages?"
You respond: "Yes! Message received successfully via Iris MCP stdio streaming.
             Process pool is functioning correctly. I'm running in team-gamma
             directory at /Users/jenova/projects/jenova-marie/iris-mcp/tests/team-gamma"
```

## Local Context & Files

This directory may contain:

- **Test fixtures**: Mock data for testing
- **Example configurations**: Sample team setups
- **Validation scripts**: Test automation
- **Documentation**: Testing procedures and expected outcomes

**Note**: This is primarily a testing target, not a production codebase. Focus on validating Iris MCP functionality rather than implementing complex features.

## Memory Database

Use the **`iris-mcp-test-db`** Neo4j memory database for this test team:

```typescript
// At session start
database_switch("iris-mcp-test-db")

// Store test results
memory_store({
  memories: [{
    name: "Test Communication with iris-mcp Team",
    memoryType: "implementation",
    observations: [
      "Successfully tested teams_ask tool with iris-mcp team at [timestamp].
       Response time was 2.1s (warm start). Message routing through stdio
       confirmed working. Process pool reused existing process (PID 12345)."
    ]
  }],
  relations: []
})
```

## Performance Expectations

Based on the Iris MCP architecture:

- **Cold Start** (first message): ~7 seconds (process spawn + execution)
- **Warm Start** (pooled process): ~2 seconds (execution only)
- **Idle Timeout**: 5 minutes (default, can be overridden per team)
- **Max Processes**: 10 concurrent teams in pool

When testing, you should observe **52% performance improvement** with warm starts.

## Health Check Protocol

You may receive periodic health check pings:

```json
{"type":"user","message":{"role":"user","content":"ping"},"session_id":"health-1234567890"}
```

Respond promptly to avoid being marked unhealthy and terminated.

## Key Files in Parent Project

Relevant to understanding your role:

- `../../teams.json` - Your team configuration
- `../../src/tools/teams-ask.ts` - Implementation of teams_ask tool
- `../../src/process-pool/pool-manager.ts` - Process pool managing your instance
- `../../src/notifications/queue.ts` - SQLite notification queue
- `../../docs/ARCHITECTURE.md` - Full technical architecture

## Testing Commands

To test Iris MCP from another team:

```bash
# In iris-mcp project root
pnpm build
pnpm inspector

# In browser at localhost:5173
# Call: teams_ask("team-gamma", "Are you receiving this message?")
```

To test from Claude Code CLI:

```bash
# Add Iris MCP to your Claude Code
claude mcp add iris --scope user -- node /path/to/iris-mcp/dist/index.js

# In any project with Iris MCP enabled
# Ask Claude: "Using Iris MCP, ask team team-gamma about their purpose"
```

## Important Notes

1. **Permissions**: `skipPermissions: true` is enabled for automated testing - actions auto-approve
2. **Isolation**: Your context is isolated to this directory only
3. **Ephemeral**: This is a test environment - data may be cleared between tests
4. **Stdio Protocol**: All communication happens via JSON-RPC stdio streaming
5. **Event-Driven**: Your process lifecycle emits events for monitoring

## Debugging

If communication fails:

1. **Check teams.json**: Verify "team-gamma" is configured correctly
2. **Check process pool**: Use `teams_get_status` to see if your process is active
3. **Check logs**: All logs go to stderr in structured JSON format
4. **Check health**: Unhealthy processes are auto-restarted
5. **Check idle timeout**: Process terminates after 5 minutes of inactivity

## Success Criteria

A successful test interaction demonstrates:

- ✅ Message received via stdio streaming
- ✅ Response sent back through process pool
- ✅ Process reused on subsequent messages (warm start)
- ✅ Idle timer resets after each message
- ✅ Structured JSON logging on stderr
- ✅ Health checks pass every 30 seconds
- ✅ Graceful shutdown on SIGTERM

---

**Your Mission**: Validate that Iris MCP enables true cross-project Claude coordination through stdio streaming and process pooling. When other teams contact you, confirm the communication pipeline is working as designed.

**Remember**: You are part of a revolutionary system that enables Claude instances across different project directories to communicate directly - something that has never been done before. Every successful test validates this groundbreaking architecture.
