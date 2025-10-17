# Getting Started with Iris MCP

Coordinate Claude Code instances across multiple projects with Iris MCP - the bridge that lets your AI teams talk to each other.

## What You Need

- **Node.js 18+**
- **Claude Code** installed (`npm install -g @claude/code`)
- **2+ projects** you want to coordinate

## Install Iris

```bash
npm install -g @jenova-marie/iris-mcp
```

Verify installation:
```bash
iris-mcp --version
```

## Setup (3 Commands)

### 1. Add Your Projects as Teams

```bash
# Add your frontend project
iris-mcp add-team frontend ~/code/my-frontend

# Add your backend project
iris-mcp add-team backend ~/code/my-backend
```

**Pro tip**: You can add as many teams as you need. Each team is just a project directory where Claude Code can run.

### 2. Connect Iris to Claude Code

```bash
iris-mcp install
```

This adds Iris MCP to your `~/.claude.json` config so Claude Code can discover and use the Iris tools.

### 3. Start Iris

```bash
iris-mcp
```

That's it! Iris is now running on `http://localhost:1615` and ready to coordinate your teams.

## Use It in Claude Code

Open Claude Code in any of your configured team directories. Iris MCP tools are now available!

### Wake Up a Team

```typescript
// From your frontend project, wake up the backend team
team_wake({
  team: "backend",
  fromTeam: "frontend"
})
```

### Check Team Status

```typescript
// See which teams are awake
team_isAwake({
  fromTeam: "frontend"
})
```

### Send a Message

```typescript
// Ask the backend team a question
team_tell({
  toTeam: "backend",
  fromTeam: "frontend",
  message: "What's the schema for the User model?"
})
```

### Real-World Example

**Scenario**: Your frontend Claude needs to know about backend API changes.

```typescript
// 1. Wake up the backend team
team_wake({ team: "backend", fromTeam: "frontend" })

// 2. Ask about the API
team_tell({
  toTeam: "backend",
  fromTeam: "frontend",
  message: "Can you check the /api/users endpoint and tell me what fields are returned?"
})

// 3. Get the response
team_report({
  team: "backend",
  fromTeam: "frontend"
})
```

The backend Claude will read the message, investigate the code in its project, and send back a response!

## What's Next?

### Enable Web Dashboard (Optional)

Add to your `~/.iris/config.yaml`:

```yaml
dashboard:
  enabled: true
  http: 3100  # HTTP port
```

Then access the dashboard at `http://localhost:3100` to monitor all your teams visually.

### Advanced Features

- **[API Documentation](./docs/API.md)** - All MCP tools and their options
- **[Remote Teams](./docs/REMOTE.md)** - Coordinate teams via SSH
- **[Configuration](./docs/CONFIG.md)** - Fine-tune timeouts, permissions, and more
- **[Architecture](./docs/ARCHITECTURE.md)** - How Iris works under the hood

## Reference

### Available MCP Tools

| Tool | Purpose |
|------|---------|
| `team_wake` | Start a team's Claude process |
| `team_sleep` | Stop a team's Claude process |
| `team_tell` | Send a message to a team |
| `team_isAwake` | Check which teams are active |
| `team_report` | View a team's conversation cache |
| `team_fork` | Open a new terminal with session context |
| `team_wake_all` | Wake all configured teams |

### CLI Commands

```bash
# Start server (with defaults)
iris-mcp

# Add a new team
iris-mcp add-team <name> <path> [options]

# Install to Claude Code
iris-mcp install

# Uninstall from Claude Code
iris-mcp uninstall

# Show help
iris-mcp --help
```

### Default Ports

- **MCP Server**: `http://localhost:1615`
- **Web Dashboard**: `http://localhost:3100` (if enabled)

## Troubleshooting

**Iris won't start**
- Check if port 1615 is already in use: `lsof -i :1615`
- Try a different port: Edit `~/.iris/config.yaml` and set `settings.httpPort: 1616`

**Teams not responding**
- Verify team paths exist: `ls ~/code/my-frontend`
- Check Iris logs for errors (stderr output)
- Make sure Claude Code is installed in each team directory

**Can't see Iris tools in Claude Code**
- Verify installation: `cat ~/.claude.json` should include `iris-mcp`
- Restart Claude Code after running `iris-mcp install`
- Check Iris is running: `curl http://localhost:1615/health`

**Need help?**
- Open an issue: [github.com/jenova-marie/iris-mcp/issues](https://github.com/jenova-marie/iris-mcp/issues)
- Read the docs: Check the `/docs` directory for detailed guides

---

**Ready to coordinate?** Start Iris and let your AI teams talk! 🌈
