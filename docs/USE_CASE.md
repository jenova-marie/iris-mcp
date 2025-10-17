# Iris MCP Use Cases: CI/CD Integration

This document outlines real-world use cases for Iris MCP's reverse tunneling capability, focusing on CI/CD pipeline integration with varying levels of autonomy.

## Overview

Iris MCP's bidirectional orchestration enables CI/CD systems (running remotely) to coordinate with local development teams through SSH reverse tunneling. This allows for intelligent, context-aware workflows that bridge the gap between automated builds and human developers.

## The Autonomy Spectrum

Different organizations have different risk tolerances and trust levels for autonomous actions. Iris MCP supports a spectrum from fully manual to highly autonomous workflows:

```
Manual ─────────────────────────────────────────────────► Autonomous
   │              │                │                 │
   │              │                │                 │
Human-Gated    Assisted       Semi-Autonomous    Full-Auto
```

---

## Use Case 1: Human-Gated (Manual Approval)

**Scenario**: Production build fails on critical authentication module

**Workflow**:
```
1. CI/CD Build Fails (main branch)
   └─> Error: TypeError: Cannot read property 'token' of undefined
       at AuthService.validate (auth.service.ts:42)

2. CI/CD wakes team-jenova via reverse MCP
   └─> Message: "🚨 Production build failed on commit abc123
       Module: authentication
       Error: TypeError in AuthService.validate
       File: auth.service.ts:42
       Priority: HIGH - blocking production deployment"

3. team-jenova receives alert and investigates
   └─> Reads error logs
   └─> Reviews recent commits
   └─> Identifies root cause

4. team-jenova fixes the issue locally
   └─> Updates auth.service.ts
   └─> Runs local tests to verify fix
   └─> Commits changes

5. team-jenova creates Pull Request
   └─> PR #143: "Fix: Handle missing token in AuthService"
   └─> Links to failed build
   └─> Includes test results

6. **HUMAN REVIEW REQUIRED** ← Critical gate
   └─> Senior developer reviews code
   └─> Security team reviews auth changes
   └─> QA verifies test coverage

7. Human approves and merges PR

8. CI/CD automatically rebuilds and deploys
```

**Characteristics**:
- ✅ Automated notification and context delivery
- ✅ Autonomous investigation and diagnosis
- ✅ Autonomous fix generation and PR creation
- ❌ **Human approval required for merge**
- **Best for**: Production code, security-critical modules, regulatory compliance

---

## Use Case 2: Assisted (Claude Investigates, Human Decides)

**Scenario**: Integration tests fail intermittently on staging

**Workflow**:
```
1. CI/CD Nightly Build Reports Flaky Tests
   └─> Test: "User login flow" failed 3/10 runs
       Last 24h failure rate: 30%

2. CI/CD wakes team-backend via reverse MCP
   └─> Message: "⚠️ Flaky test detected: User login flow
       Failure rate: 30% (3/10 runs)
       Last passed: 6 hours ago
       Possible race condition or timing issue"

3. team-backend investigates autonomously
   └─> Analyzes test logs across all 10 runs
   └─> Identifies timing variance in async operations
   └─> Compares successful vs failed runs
   └─> Generates diagnostic report

4. team-backend reports findings to developers
   └─> Creates detailed investigation report
   └─> Suggests fix: Add explicit wait for auth token
   └─> Proposes code changes with diff

5. **HUMAN REVIEWS PROPOSAL** ← Decision gate
   └─> Developer reads investigation report
   └─> Reviews proposed fix
   └─> Decides: approve, modify, or reject

6. If approved: team-backend creates PR
   └─> Human merges after final review
```

**Characteristics**:
- ✅ Automated investigation and root cause analysis
- ✅ Autonomous diagnostic report generation
- ✅ Suggested fixes with code diffs
- ❌ **Human decides whether to proceed**
- **Best for**: Non-blocking tests, investigation-heavy issues, learning scenarios

---

## Use Case 3: Semi-Autonomous (Auto-PR with Human Gate)

**Scenario**: Dependency updates fail during automated maintenance

**Workflow**:
```
1. CI/CD Weekly Dependency Update Build Fails
   └─> Package: @types/node updated 18.x → 20.x
       Breaking change: fs.promises.readFile signature changed

2. CI/CD wakes team-dependencies via reverse MCP
   └─> Message: "📦 Dependency update failed: @types/node
       Version: 18.x → 20.x
       Impact: 12 type errors in file operations
       Policy: Auto-fix allowed for dependency updates"

3. team-dependencies autonomously fixes type errors
   └─> Updates fs.promises.readFile calls (12 files)
   └─> Updates type annotations
   └─> Runs type checker to verify
   └─> Runs unit tests to verify behavior

4. team-dependencies creates PR automatically
   └─> PR #144: "chore: Fix type errors for @types/node 20.x"
   └─> Includes: changelog, test results, type check output
   └─> Auto-labels: "dependencies", "autogenerated"

5. CI/CD runs full test suite on PR
   └─> All tests pass ✓
   └─> Type checking passes ✓
   └─> Linting passes ✓

6. **HUMAN REVIEW** (but streamlined)
   └─> Developer sees: "Auto-fix PR - all checks passed"
   └─> Quick review of changes (diff is clean)
   └─> Approves and merges

7. Optional: Auto-merge if org policy allows
   └─> "Auto-approve PRs from team-dependencies
       IF: labeled 'dependencies'
       AND: all CI checks pass
       AND: no security alerts"
```

**Characteristics**:
- ✅ Fully autonomous fix generation and PR creation
- ✅ Autonomous testing and validation
- ⚠️ **Human approval recommended but streamlined**
- ⚠️ **Optional auto-merge with strict policies**
- **Best for**: Dependency updates, code formatting, documentation fixes

---

## Use Case 4: Full-Autonomous (Trusted Patterns Only)

**Scenario**: Documentation typos detected in CI/CD spelling check

**Workflow**:
```
1. CI/CD Runs Spelling/Grammar Check on Docs
   └─> Found 5 typos in README.md
   └─> Found 2 grammar issues in API.md

2. CI/CD wakes team-docs via reverse MCP
   └─> Message: "📝 Documentation issues detected
       Severity: LOW
       Auto-fix policy: ENABLED for docs"

3. team-docs fixes issues autonomously
   └─> Corrects typos in README.md
   └─> Fixes grammar in API.md
   └─> Runs spell checker to verify

4. team-docs creates PR automatically
   └─> PR #145: "docs: Fix spelling and grammar"
   └─> Auto-labels: "documentation", "auto-fix"

5. CI/CD auto-merges PR (policy-based)
   └─> Condition 1: Source is team-docs ✓
   └─> Condition 2: Files match pattern: **.md ✓
   └─> Condition 3: No security implications ✓
   └─> Condition 4: All CI checks pass ✓
   └─> **AUTO-MERGE APPROVED**

6. Notification sent to team
   └─> "FYI: Auto-merged documentation fixes (PR #145)"
   └─> Developers can review post-merge if desired
```

**Characteristics**:
- ✅ Fully autonomous fix, PR, and merge
- ✅ No human interaction required
- ⚠️ **Strict policy enforcement required**
- ⚠️ **Limited to low-risk changes only**
- **Best for**: Documentation, formatting, linting auto-fixes, typos

---

## Policy Configuration Examples

### Conservative Policy (High-Risk Codebase)
```json
{
  "autoApproval": {
    "enabled": false,
    "allowedTeams": [],
    "allowedPatterns": [],
    "requireHumanReview": true
  }
}
```

### Balanced Policy (Typical Production App)
```json
{
  "autoApproval": {
    "enabled": true,
    "allowedTeams": ["team-docs", "team-dependencies"],
    "allowedPatterns": [
      "**.md",           // Documentation
      "package-lock.json" // Dependency updates
    ],
    "blockedPatterns": [
      "**auth**",        // Never auto-merge auth code
      "**security**"     // Never auto-merge security code
    ],
    "requireAllChecks": true,
    "requireHumanReview": {
      "production": true,
      "staging": false
    }
  }
}
```

### Aggressive Policy (Internal Tools / Experimental)
```json
{
  "autoApproval": {
    "enabled": true,
    "allowedTeams": ["team-docs", "team-dependencies", "team-backend", "team-frontend"],
    "allowedPatterns": ["**"],
    "blockedPatterns": [
      "**security**",
      "**secrets**",
      ".env*"
    ],
    "requireAllChecks": true,
    "requireHumanReview": false,
    "notifyOnMerge": true  // Still send notifications
  }
}
```

---

## Advanced Scenarios

### Scenario A: Multi-Team Coordination
```
CI/CD detects API breaking change
    ↓
CI/CD wakes team-backend (API owners)
    ↓
team-backend proposes fix
    ↓
team-backend wakes team-frontend: "API change requires frontend updates"
    ↓
team-frontend updates API calls
    ↓
Both teams create PRs that link together
    ↓
Human reviews coordinated changes
    ↓
Both PRs merged together (atomic deployment)
```

### Scenario B: Rollback Automation
```
CI/CD detects production error spike after deployment
    ↓
CI/CD wakes team-oncall
    ↓
team-oncall analyzes error logs and recent deployments
    ↓
team-oncall determines: last deploy (PR #142) caused issue
    ↓
team-oncall creates revert PR automatically
    ↓
team-oncall notifies on-call engineer: "Proposed rollback ready"
    ↓
Engineer reviews and approves (or overrides)
    ↓
Rollback deployed within minutes
```

### Scenario C: Security Vulnerability Response
```
Security scanner detects CVE in dependency
    ↓
CI/CD wakes team-security
    ↓
team-security analyzes vulnerability impact
    ↓
team-security checks for available patch
    ↓
team-security updates dependency and runs tests
    ↓
team-security creates URGENT PR with security label
    ↓
**HUMAN SECURITY REVIEW REQUIRED** (always)
    ↓
Security team approves emergency merge
```

---

## Trust Progression Over Time

As AI capabilities improve and teams build confidence, the autonomy level can increase:

**Phase 1: Learning** (Months 1-3)
- All PRs require human approval
- Claude generates reports and suggestions
- Humans learn to trust the analysis

**Phase 2: Selective Automation** (Months 4-6)
- Auto-merge for documentation and dependencies
- Assisted mode for bug fixes
- Human review for logic changes

**Phase 3: High Trust** (Months 7+)
- Auto-merge for non-critical modules
- Semi-autonomous for most fixes
- Human review only for critical paths

**Key Principle**: Start conservative, measure outcomes, increase automation based on demonstrated reliability.

---

## Metrics to Track

To determine appropriate autonomy levels:

```
- **Accuracy Rate**: % of autonomous fixes that pass human review
- **False Positive Rate**: % of flagged issues that weren't real problems
- **Time Saved**: Hours of developer time saved vs manual investigation
- **Rollback Rate**: % of auto-merged PRs that required rollback
- **Coverage**: % of build failures that were auto-resolved
```

**Safe thresholds for increasing autonomy**:
- Accuracy Rate > 95%
- Rollback Rate < 2%
- False Positive Rate < 10%

---

## Conclusion

Iris MCP's reverse tunneling enables a **spectrum of autonomy** in CI/CD workflows. Teams can start conservative with human-gated approvals and progressively increase automation as trust builds.

The key insight: **Autonomous investigation and PR creation are valuable even when human approval is required.** The speed and context preservation alone justify the integration, and full automation becomes an option as AI capabilities improve.

**The future is already here** - it's just a matter of configuring the right trust policies for your organization's risk tolerance.
