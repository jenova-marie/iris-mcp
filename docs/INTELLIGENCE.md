# Iris Intelligence Layer: Agent SDK Integration Addendum

**Self-Aware Coordination with Claude Agent SDK**

*"Code is precious and should be handled with the highest of thought possible."*

---

## 🎯 Vision

The Iris Intelligence Layer transforms Iris from a simple message relay into an **intelligent orchestrator** that thinks critically about coordination decisions. Using the Claude Agent SDK, Iris gains meta-cognitive abilities to:

- 🔄 **Detect infinite loops** before they waste resources
- 🛡️ **Prevent destructive actions** that could harm codebases
- 🧠 **Recognize patterns** in team communication
- 💡 **Suggest optimizations** for better coordination
- 🚨 **Alert on anomalies** in agent behavior
- 📊 **Learn from history** to improve over time

**Iris becomes self-aware** - she doesn't just execute commands blindly, she *understands* the implications and acts accordingly.

---

## 📋 For README.md

### Add new section after "CLI":

---

## 🧠 Intelligence Layer (Self-Aware Coordination)

Iris includes an **Intelligence Layer** powered by the Claude Agent SDK that monitors coordination patterns and prevents common pitfalls in multi-agent systems.

### What It Does

**Loop Detection:**
```bash
# Iris detects when teams are stuck in a loop
Frontend → Backend: "What's your API version?"
Backend → Frontend: "What's your API version?"
Frontend → Backend: "What's your API version?"

⚠️  Iris Intelligence: Detected circular conversation loop between
    Frontend and Backend (3 identical exchanges in 2 minutes).

    Suggested Action: Break the loop and clarify the original question.

    [Allow Loop] [Break & Clarify] [Ignore Warning]
```

**Destructive Action Prevention:**
```bash
User: "iris exec backend 'rm -rf node_modules prisma/migrations'"

🛑 Iris Intelligence: This command will DELETE CRITICAL FILES:
   • node_modules/ (dependencies)
   • prisma/migrations/ (database history)

   Impact Analysis:
   - Backend will be unable to start
   - Database rollback will be impossible
   - 47 migrations will be permanently lost

   Confidence: 99% this is DESTRUCTIVE

   Continue anyway? [y/N]
```

**Pattern Recognition:**
```bash
📊 Iris Intelligence: Weekly Coordination Report

   Most Common Questions:
   • "What's your API strategy?" (asked 12 times)
     → Suggestion: Document this in ARCHITECTURE.md

   • "How do I run tests?" (asked 8 times)
     → Suggestion: Add to README.md or create /test command

   Inefficient Patterns:
   • Frontend asks Backend the same question within 1 hour (3 times)
     → Suggestion: Cache responses or use shared documentation

   [View Full Report] [Apply Suggestions]
```

**Anomaly Detection:**
```bash
🚨 Iris Intelligence: Unusual Activity Detected

   Team "backend" has:
   - Processed 47 messages in the last 10 minutes (normal: ~5)
   - Failed 12 consecutive operations (normal: <2 failures/hour)
   - CPU usage at 98% (normal: 15-30%)

   Possible Causes:
   1. Infinite loop in code execution
   2. Resource exhaustion
   3. External service outage

   Recommended Actions:
   - Terminate backend agent process
   - Review recent message history
   - Check system logs

   [Terminate Process] [View Logs] [Ignore]
```

### Configuration

Enable/configure the Intelligence Layer in `iris-config.json`:

```json
{
  "intelligence": {
    "enabled": true,
    "features": {
      "loopDetection": {
        "enabled": true,
        "threshold": 3,
        "windowSeconds": 120
      },
      "destructiveActionPrevention": {
        "enabled": true,
        "requireConfirmation": true,
        "blockPatterns": [
          "rm -rf",
          "DROP DATABASE",
          "DELETE FROM.*WHERE 1=1",
          "git reset --hard HEAD~"
        ]
      },
      "patternRecognition": {
        "enabled": true,
        "weeklyReports": true,
        "autoSuggest": true
      },
      "anomalyDetection": {
        "enabled": true,
        "metrics": ["messageRate", "failureRate", "cpuUsage"],
        "alertThreshold": "high"
      }
    },
    "agentSdk": {
      "model": "claude-sonnet-4-5-20250929",
      "systemPrompt": "You are Iris Intelligence, a meta-cognitive layer...",
      "maxTokens": 4000
    }
  }
}
```

### How It Works

The Intelligence Layer uses the Claude Agent SDK to maintain a **meta-agent** that:

1. **Monitors** all messages flowing through Iris
2. **Analyzes** patterns, intents, and potential risks
3. **Intervenes** when necessary to prevent issues
4. **Learns** from coordination history to improve suggestions
5. **Reports** insights and optimization opportunities

### CLI Integration

```bash
# Check intelligence insights
iris intelligence report

# View detected patterns
iris intelligence patterns --since "1 week"

# Review prevented actions
iris intelligence prevented

# Configure intelligence features
iris intelligence config --loop-detection=on --threshold=3

# Temporarily disable for urgent actions
iris ask backend "risky command" --bypass-intelligence
```

---

## 📋 For ARCHITECTURE.md

### Add new section after "CLI Architecture":

---

## 🧠 Intelligence Layer Architecture

### Overview

The Intelligence Layer is a **meta-cognitive system** that monitors and analyzes all coordination activities within Iris. It uses the Claude Agent SDK to maintain an intelligent agent that acts as a guardian, optimizer, and advisor for multi-agent coordination.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    All Iris Interactions                         │
│  (MCP Tools, HTTP API, CLI, Dashboard)                          │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ Every message/action flows through
                         │
┌────────────────────────▼────────────────────────────────────────┐
│              Intelligence Layer Gateway                          │
│         (Intercepts & Analyzes All Operations)                   │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Pre-Execution Analysis                                     │ │
│  │  • Intent classification                                    │ │
│  │  • Risk assessment                                          │ │
│  │  • Pattern matching                                         │ │
│  │  • Context enrichment                                       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                         ↓                                         │
│                    Decision Point                                │
│                         ↓                                         │
│           ┌─────────────┴─────────────┐                         │
│           │                            │                          │
│      SAFE Action                  RISKY Action                   │
│           │                            │                          │
│           ↓                            ↓                          │
│    Execute Normally        ┌────────────────────┐               │
│                            │ Meta-Agent         │               │
│                            │ (Claude Agent SDK) │               │
│                            │                    │               │
│                            │ Analyzes:          │               │
│                            │ • Destructiveness  │               │
│                            │ • Loop potential   │               │
│                            │ • Resource impact  │               │
│                            │ • Historical data  │               │
│                            │                    │               │
│                            │ Provides:          │               │
│                            │ • Risk score       │               │
│                            │ • Explanation      │               │
│                            │ • Alternatives     │               │
│                            │ • Decision         │               │
│                            └────────────────────┘               │
│                                     │                             │
│                        ┌────────────┴────────────┐              │
│                        │                          │               │
│                    BLOCK Action             REQUEST Confirmation  │
│                        │                          │               │
│                   Notify User              User Decides           │
│                   Log Event                      │                │
│                        │              ┌──────────┴──────────┐    │
│                        │              │                      │     │
│                        │          Approved              Denied    │
│                        │              │                      │     │
│                        ↓              ↓                      ↓     │
│                   Don't Execute   Execute              Cancel     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Post-Execution
                              │
┌─────────────────────────────▼───────────────────────────────────┐
│              Intelligence Layer Analysis                         │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Post-Execution Processing                                  │ │
│  │  • Record outcome                                           │ │
│  │  • Update pattern database                                  │ │
│  │  • Detect anomalies                                         │ │
│  │  • Generate insights                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Learning & Optimization                                    │ │
│  │  • Identify recurring patterns                              │ │
│  │  • Suggest documentation updates                            │ │
│  │  • Recommend coordination improvements                      │ │
│  │  • Adjust detection thresholds                              │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Continuous monitoring
                              │
┌─────────────────────────────▼───────────────────────────────────┐
│              Analytics & Reporting Engine                        │
│                                                                   │
│  • Weekly coordination reports                                   │
│  • Anomaly alerts                                                │
│  • Optimization suggestions                                      │
│  • Historical trend analysis                                     │
└──────────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. Intelligence Gateway (`src/intelligence/gateway.ts`)

**Responsibilities:**
- Intercept all operations before execution
- Route to appropriate analyzers
- Enforce safety policies
- Log all decisions

```typescript
export class IntelligenceGateway {
  constructor(
    private metaAgent: MetaAgent,
    private config: IntelligenceConfig
  ) {}

  async analyzeOperation(operation: Operation): Promise<AnalysisResult> {
    // Fast-path for obviously safe operations
    if (this.isObviouslySafe(operation)) {
      return { allowed: true, risk: 'none' };
    }

    // Check for destructive patterns
    if (this.config.features.destructiveActionPrevention.enabled) {
      const destructive = await this.checkDestructive(operation);
      if (destructive.isDestructive) {
        return {
          allowed: false,
          risk: 'critical',
          reason: destructive.reason,
          alternatives: destructive.alternatives
        };
      }
    }

    // Check for loops
    if (this.config.features.loopDetection.enabled) {
      const loop = await this.checkLoop(operation);
      if (loop.isLoop) {
        return {
          allowed: false,
          risk: 'high',
          reason: 'Detected circular conversation pattern',
          suggestion: loop.breakPattern
        };
      }
    }

    // Deep analysis for complex cases
    if (operation.requiresDeepAnalysis) {
      return await this.metaAgent.analyze(operation);
    }

    return { allowed: true, risk: 'low' };
  }

  private isObviouslySafe(operation: Operation): boolean {
    const safePatterns = [
      /^iris status/,
      /^iris history/,
      /^iris config show/,
      /what.*\?$/i,  // Questions
      /how.*\?$/i
    ];

    return safePatterns.some(pattern =>
      pattern.test(operation.command)
    );
  }

  private async checkDestructive(
    operation: Operation
  ): Promise<DestructiveAnalysis> {
    const blockPatterns = this.config.features
      .destructiveActionPrevention.blockPatterns;

    for (const pattern of blockPatterns) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(operation.command)) {
        // Use meta-agent to analyze impact
        const impact = await this.metaAgent.analyzeImpact(operation);

        return {
          isDestructive: true,
          confidence: impact.confidence,
          reason: impact.explanation,
          affectedFiles: impact.files,
          alternatives: impact.saferAlternatives
        };
      }
    }

    return { isDestructive: false };
  }
}
```

#### 2. Meta-Agent (Claude Agent SDK) (`src/intelligence/meta-agent.ts`)

**Responsibilities:**
- Deep reasoning about operations
- Context-aware risk assessment
- Provide explanations and alternatives
- Learn from feedback

```typescript
import { query } from '@anthropic-ai/claude-code';

export class MetaAgent {
  constructor(private config: IntelligenceConfig) {}

  async analyze(operation: Operation): Promise<AnalysisResult> {
    const prompt = this.buildAnalysisPrompt(operation);

    let analysis = '';
    for await (const message of query({
      prompt,
      options: {
        model: this.config.agentSdk.model,
        maxTokens: this.config.agentSdk.maxTokens,
        systemPrompt: this.config.agentSdk.systemPrompt
      }
    })) {
      if (message.type === 'result') {
        analysis = message.content;
      }
    }

    return this.parseAnalysis(analysis);
  }

  async analyzeImpact(operation: Operation): Promise<ImpactAnalysis> {
    const context = await this.gatherContext(operation);

    const prompt = `
Analyze the potential impact of this operation:

Operation: ${operation.command}
Target Team: ${operation.team}
Context: ${JSON.stringify(context, null, 2)}

Provide a detailed impact analysis:
1. What files or resources will be affected?
2. What is the confidence level this is destructive (0-100)?
3. What are the potential consequences?
4. What safer alternatives exist?

Format your response as JSON:
{
  "confidence": <0-100>,
  "explanation": "...",
  "files": ["..."],
  "consequences": ["..."],
  "saferAlternatives": ["..."]
}
`;

    let result = '';
    for await (const message of query({ prompt })) {
      if (message.type === 'result') {
        result = message.content;
      }
    }

    return JSON.parse(result);
  }

  private buildAnalysisPrompt(operation: Operation): string {
    const history = this.getRecentHistory(operation.team);

    return `
You are Iris Intelligence, a meta-cognitive layer that protects codebases
from accidental harm while facilitating effective agent coordination.

Analyze this operation:

Team: ${operation.team}
Command: ${operation.command}
Context: ${operation.context}

Recent History (last 10 messages):
${history.map(h => `${h.from} → ${h.to}: ${h.message}`).join('\n')}

Assess:
1. Risk Level (none/low/medium/high/critical)
2. Is this part of a loop or repetitive pattern?
3. Could this cause unintended harm?
4. Are there better ways to accomplish the goal?

Provide your analysis in this format:
RISK: <level>
ALLOWED: <yes/no>
REASON: <explanation>
SUGGESTION: <optional alternative>
`;
  }

  private parseAnalysis(text: string): AnalysisResult {
    const riskMatch = text.match(/RISK:\s*(\w+)/i);
    const allowedMatch = text.match(/ALLOWED:\s*(\w+)/i);
    const reasonMatch = text.match(/REASON:\s*(.+)/i);
    const suggestionMatch = text.match(/SUGGESTION:\s*(.+)/i);

    return {
      risk: riskMatch?.[1] || 'unknown',
      allowed: allowedMatch?.[1]?.toLowerCase() === 'yes',
      reason: reasonMatch?.[1] || 'No reason provided',
      suggestion: suggestionMatch?.[1]
    };
  }
}
```

#### 3. Loop Detector (`src/intelligence/loop-detector.ts`)

**Responsibilities:**
- Detect circular conversation patterns
- Identify repetitive questions
- Suggest loop-breaking strategies

```typescript
export class LoopDetector {
  private messageHistory: Map<string, Message[]> = new Map();

  constructor(private config: LoopDetectionConfig) {}

  async checkLoop(operation: Operation): Promise<LoopAnalysis> {
    const key = `${operation.from}-${operation.to}`;
    const history = this.messageHistory.get(key) || [];

    // Add current operation to history
    history.push({
      message: operation.message,
      timestamp: Date.now()
    });

    // Keep only messages within the time window
    const cutoff = Date.now() - (this.config.windowSeconds * 1000);
    const recentHistory = history.filter(m => m.timestamp > cutoff);

    this.messageHistory.set(key, recentHistory);

    // Check for loops
    if (recentHistory.length < this.config.threshold) {
      return { isLoop: false };
    }

    // Detect identical or highly similar messages
    const similarities = this.computeSimilarities(recentHistory);
    const loopFound = similarities.filter(s => s > 0.9).length >= this.config.threshold;

    if (loopFound) {
      return {
        isLoop: true,
        iterations: similarities.filter(s => s > 0.9).length,
        breakPattern: await this.suggestBreakPattern(recentHistory)
      };
    }

    return { isLoop: false };
  }

  private computeSimilarities(messages: Message[]): number[] {
    const similarities: number[] = [];

    for (let i = 1; i < messages.length; i++) {
      const similarity = this.stringSimilarity(
        messages[i].message,
        messages[i - 1].message
      );
      similarities.push(similarity);
    }

    return similarities;
  }

  private stringSimilarity(a: string, b: string): number {
    // Levenshtein distance normalized to 0-1 range
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;

    if (longer.length === 0) return 1.0;

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  private async suggestBreakPattern(history: Message[]): Promise<string> {
    return `
Detected loop pattern: ${history[0].message}

Suggested actions:
1. Rephrase the question to be more specific
2. Provide additional context about what you're trying to accomplish
3. Check if documentation already answers this question
4. Ask a different team member who might have more context
`;
  }
}
```

#### 4. Pattern Recognizer (`src/intelligence/pattern-recognizer.ts`)

**Responsibilities:**
- Identify recurring questions/patterns
- Suggest documentation improvements
- Detect optimization opportunities

```typescript
export class PatternRecognizer {
  private patterns: Map<string, Pattern> = new Map();

  async recordMessage(message: Message): Promise<void> {
    const normalized = this.normalizeMessage(message.content);

    const existing = this.patterns.get(normalized);
    if (existing) {
      existing.count++;
      existing.lastSeen = Date.now();
      existing.examples.push(message);
    } else {
      this.patterns.set(normalized, {
        normalized,
        count: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        examples: [message]
      });
    }
  }

  async generateWeeklyReport(): Promise<WeeklyReport> {
    const topPatterns = Array.from(this.patterns.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const suggestions: Suggestion[] = [];

    for (const pattern of topPatterns) {
      if (pattern.count >= 5) {
        // Use meta-agent to generate suggestion
        const suggestion = await this.generateSuggestion(pattern);
        suggestions.push(suggestion);
      }
    }

    return {
      period: 'last 7 days',
      topPatterns,
      suggestions,
      metrics: this.computeMetrics()
    };
  }

  private async generateSuggestion(pattern: Pattern): Promise<Suggestion> {
    const metaAgent = new MetaAgent(config);

    const prompt = `
This question has been asked ${pattern.count} times in the last week:
"${pattern.normalized}"

Examples:
${pattern.examples.slice(0, 3).map(e => `- ${e.content}`).join('\n')}

Suggest how to improve coordination to reduce this repetition:
1. Should this be documented? Where?
2. Could a shared resource or tool help?
3. Is there a process issue causing the repetition?

Provide actionable suggestions.
`;

    let analysis = '';
    for await (const message of query({ prompt })) {
      if (message.type === 'result') {
        analysis = message.content;
      }
    }

    return {
      pattern: pattern.normalized,
      frequency: pattern.count,
      recommendation: analysis,
      impact: 'high'
    };
  }

  private normalizeMessage(content: string): string {
    // Remove specific details, keep the essence
    return content
      .toLowerCase()
      .replace(/\d+/g, 'N')  // Replace numbers
      .replace(/v\d+\.\d+/g, 'vX.Y')  // Replace versions
      .trim();
  }
}
```

#### 5. Anomaly Detector (`src/intelligence/anomaly-detector.ts`)

**Responsibilities:**
- Monitor system metrics
- Detect unusual activity patterns
- Alert on potential issues

```typescript
export class AnomalyDetector {
  private baseline: Map<string, Baseline> = new Map();

  async detectAnomalies(team: string): Promise<Anomaly[]> {
    const current = await this.getCurrentMetrics(team);
    const baseline = this.baseline.get(team);

    if (!baseline) {
      // First time seeing this team, establish baseline
      this.baseline.set(team, {
        messageRate: current.messageRate,
        failureRate: current.failureRate,
        cpuUsage: current.cpuUsage,
        sampleSize: 1
      });
      return [];
    }

    const anomalies: Anomaly[] = [];

    // Check message rate
    if (current.messageRate > baseline.messageRate * 3) {
      anomalies.push({
        type: 'high_message_rate',
        severity: 'warning',
        current: current.messageRate,
        expected: baseline.messageRate,
        message: `Team ${team} processing ${current.messageRate} msg/min (normal: ${baseline.messageRate})`
      });
    }

    // Check failure rate
    if (current.failureRate > baseline.failureRate * 2) {
      anomalies.push({
        type: 'high_failure_rate',
        severity: 'critical',
        current: current.failureRate,
        expected: baseline.failureRate,
        message: `Team ${team} has ${current.failureRate}% failure rate (normal: ${baseline.failureRate}%)`
      });
    }

    // Check CPU usage
    if (current.cpuUsage > 90) {
      anomalies.push({
        type: 'high_cpu',
        severity: 'warning',
        current: current.cpuUsage,
        expected: baseline.cpuUsage,
        message: `Team ${team} CPU at ${current.cpuUsage}% (normal: ${baseline.cpuUsage}%)`
      });
    }

    // Update baseline (exponential moving average)
    this.updateBaseline(team, current);

    return anomalies;
  }

  private updateBaseline(team: string, current: Metrics): void {
    const baseline = this.baseline.get(team)!;
    const alpha = 0.2; // Weight for new observations

    baseline.messageRate = alpha * current.messageRate +
                           (1 - alpha) * baseline.messageRate;
    baseline.failureRate = alpha * current.failureRate +
                           (1 - alpha) * baseline.failureRate;
    baseline.cpuUsage = alpha * current.cpuUsage +
                        (1 - alpha) * baseline.cpuUsage;
    baseline.sampleSize++;
  }
}
```

### Database Schema

```sql
-- Intelligence events log
CREATE TABLE intelligence_events (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  event_type TEXT NOT NULL, -- loop_detected, destructive_blocked, anomaly_found, etc.
  team TEXT,
  operation TEXT,
  risk_level TEXT,
  allowed BOOLEAN,
  reason TEXT,
  metadata TEXT -- JSON
);

CREATE INDEX idx_events_timestamp ON intelligence_events(timestamp DESC);
CREATE INDEX idx_events_type ON intelligence_events(event_type);
CREATE INDEX idx_events_team ON intelligence_events(team);

-- Pattern database
CREATE TABLE coordination_patterns (
  id TEXT PRIMARY KEY,
  normalized_question TEXT NOT NULL,
  count INTEGER DEFAULT 1,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  examples TEXT, -- JSON array
  suggestion TEXT,
  resolved BOOLEAN DEFAULT 0
);

CREATE INDEX idx_patterns_count ON coordination_patterns(count DESC);
CREATE INDEX idx_patterns_resolved ON coordination_patterns(resolved);

-- Anomaly alerts
CREATE TABLE anomaly_alerts (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  team TEXT NOT NULL,
  anomaly_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  current_value REAL,
  expected_value REAL,
  message TEXT,
  acknowledged BOOLEAN DEFAULT 0
);

CREATE INDEX idx_alerts_team ON anomaly_alerts(team);
CREATE INDEX idx_alerts_severity ON anomaly_alerts(severity);
CREATE INDEX idx_alerts_acknowledged ON anomaly_alerts(acknowledged);
```

### User Experience

#### Dashboard Integration

The Intelligence Layer provides a dedicated dashboard section:

```
┌─────────────────────────────────────────────────────────────┐
│  🧠 Iris Intelligence                                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Today's Activity:                                           │
│  ✓ 47 operations analyzed                                   │
│  ⚠ 2 loops prevented                                        │
│  🛡 1 destructive action blocked                            │
│  💡 5 optimization suggestions generated                    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Recent Interventions                                 │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │  14:32  🔄 Loop Detected                             │  │
│  │         Frontend ↔ Backend circular conversation      │  │
│  │         [View Details]                                │  │
│  │                                                        │  │
│  │  13:15  🛡 Destructive Command Blocked               │  │
│  │         `rm -rf prisma/migrations` on backend        │  │
│  │         [Review Decision]                             │  │
│  │                                                        │  │
│  │  12:40  💡 Pattern Recognized                        │  │
│  │         "How do I run tests?" asked 8 times          │  │
│  │         [Apply Suggestion]                            │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  [View Weekly Report] [Configure Intelligence] [History]    │
└─────────────────────────────────────────────────────────────┘
```

#### CLI Integration

```bash
# View intelligence report
$ iris intelligence report

🧠 Iris Intelligence Report (Last 7 Days)

Operations Analyzed: 342
Prevented Issues: 8
  • 3 circular conversation loops
  • 2 destructive commands
  • 3 resource exhaustion risks

Top Suggestions:
  1. Document "What's our API versioning?" (asked 12 times)
  2. Create /test command (asked 8 times)
  3. Set up shared cache for Frontend-Backend queries

[View Full Report] [Export JSON]

# Review prevented actions
$ iris intelligence prevented

🛡 Prevented Destructive Actions:

2025-01-15 14:32  backend
  Command: rm -rf node_modules prisma/migrations
  Risk: CRITICAL (99% confidence)
  Reason: Would delete 47 migration files permanently
  User Action: Cancelled

2025-01-14 09:15  frontend
  Command: git reset --hard HEAD~10
  Risk: HIGH (87% confidence)
  Reason: Would lose 10 commits of work
  User Action: Cancelled

# Configure intelligence
$ iris intelligence config

Current Configuration:
  Loop Detection: ✓ Enabled (threshold: 3, window: 120s)
  Destructive Prevention: ✓ Enabled
  Pattern Recognition: ✓ Enabled
  Anomaly Detection: ✓ Enabled

Modify:
  [1] Enable/Disable Features
  [2] Adjust Thresholds
  [3] Configure Block Patterns
  [4] Set Alert Preferences
```

### Performance Considerations

**Latency Impact:**
- Fast-path for obvious operations: <5ms overhead
- Pattern matching: ~10ms
- Meta-agent analysis: ~1-3s (only for complex cases)

**Resource Usage:**
- Intelligence Gateway: ~50MB RAM
- Pattern database: ~10MB per 10K messages
- Meta-agent calls: Minimal (only when needed)

**Optimization Strategies:**
1. Cache common analyses
2. Use fast-path for safe operations
3. Async processing for non-blocking analysis
4. Batch pattern recognition updates

### Future Enhancements

**Planned Features:**
- 🎓 **Learning from Feedback** - Improve from user corrections
- 🤝 **Collaborative Filtering** - Learn from other Iris instances
- 📈 **Predictive Analytics** - Anticipate coordination needs
- 🎯 **Smart Routing** - Suggest best team for each question
- 🔮 **Proactive Suggestions** - "You might want to ask Backend about X"

---

**The Intelligence Layer makes Iris truly thoughtful.** She doesn't just execute - she *understands*, *protects*, and *optimizes*. 🧠✨
