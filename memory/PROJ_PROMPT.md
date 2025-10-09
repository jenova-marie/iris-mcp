# Project Memory Initialization Prompt

## Objective

You will perform a comprehensive evaluation of an existing software project and create initial memory structures in Neo4j using the MCP Neo4j Memory Server. This process establishes a foundation for ongoing project memory management.

## Prerequisites

Before starting, ensure:
1. You have access to the MCP Neo4j Memory Server tools
2. The project database is created and accessible
3. You have read the MEM_PROMPT.md document for memory modeling guidelines
4. You understand the project's codebase structure and documentation

## Initialization Process

### Phase 1: Database Setup and Context Discovery

#### Step 1: Database Preparation
```
1. Execute database_switch to "project-name-db"
2. Verify connection and clean slate (search for existing memories)
3. If existing memories found, analyze coverage gaps
```

#### Step 2: Project Structure Analysis
Examine the project to understand:
- **Codebase Structure**: Directory layout, file organization, architectural patterns
- **Technology Stack**: Languages, frameworks, libraries, tools in use
- **Documentation**: README files, API docs, architectural decision records
- **Version Control**: Git history, branching strategy, recent commits
- **Dependencies**: package.json, requirements.txt, build files
- **Configuration**: Environment configs, deployment scripts, CI/CD setup
- **Testing**: Test files, coverage reports, testing frameworks

#### Step 3: Stakeholder Identification
Identify key people from:
- Git commit history (authors and committers)
- Code review comments
- Documentation authorship
- Issue tracking systems
- Team documentation or org charts

### Phase 2: Core Memory Creation

#### Technology Stack Memories

Create Technology nodes for:
```json
[
  {
    "name": "Primary language (e.g., TypeScript)",
    "memoryType": "technology",
    "metadata": {
      "category": "language",
      "version": "detected version",
      "status": "active",
      "purpose": "primary development language"
    }
  },
  {
    "name": "Framework (e.g., Next.js)",
    "memoryType": "technology",
    "metadata": {
      "category": "framework",
      "version": "package.json version",
      "adoptionReason": "inferred or documented reason"
    }
  }
]
```

For each technology, add observations about:
- How it's used in the project
- Configuration details
- Performance characteristics observed
- Integration challenges or benefits

#### Person Memories

Create Person nodes for key contributors:
```json
[
  {
    "name": "Primary author name",
    "memoryType": "person",
    "metadata": {
      "role": "inferred from commits",
      "active": "true/false based on recent activity",
      "expertise": ["languages", "areas of contribution"]
    },
    "observations": [
      {
        "content": "Primary contributor to X module",
        "context": "Based on Git commit analysis"
      }
    ]
  }
]
```

#### Environment Memories

Identify and create Environment nodes:
```json
[
  {
    "name": "development",
    "memoryType": "environment",
    "metadata": {
      "provider": "local",
      "status": "active",
      "purpose": "development environment"
    }
  },
  {
    "name": "production",
    "memoryType": "environment",
    "metadata": {
      "provider": "inferred from configs",
      "deploymentMethod": "detected method",
      "monitoring": ["detected tools"]
    }
  }
]
```

### Phase 3: Code Structure Analysis

#### File System Mapping

For each significant code file, create CodeFile nodes:

**Priority Order:**
1. Main entry points (index.js, main.py, app.ts)
2. Core business logic files
3. Configuration files
4. API route definitions
5. Database models/schemas
6. Utility and helper files
7. Test files

**CodeFile Memory Template:**
```json
{
  "name": "filename.ext",
  "memoryType": "codefile",
  "metadata": {
    "path": "relative/path/to/file",
    "language": "detected language",
    "size": "file size bytes",
    "purpose": "inferred purpose",
    "lastModified": "git last modified date"
  },
  "observations": [
    {
      "content": "Decision made based on [analysis of evidence]",
      "context": "Initial project analysis"
    }
  ],
  "relations": [
    {
      "targetId": "affected_feature_id",
      "relation": "INFLUENCES",
      "properties": {
        "strength": 0.9,
        "type": "positive"
      }
    }
  ]
}
```

### Phase 6: Dependency Mapping

#### Internal Dependencies

Analyze code imports/requires to map:
- File-to-file dependencies
- Function-to-function calls
- Module-to-module relationships

Create DEPENDS_ON relationships with properties:
```json
{
  "type": "hard",
  "reason": "imports functionality",
  "confidence": "high"
}
```

#### External Dependencies

From package manifests (package.json, requirements.txt, etc.):
- Create Technology nodes for major dependencies
- Link CodeFiles to Technologies they use
- Note version constraints and update frequency

### Phase 7: Relationship Network Building

#### Cross-Reference Everything

Systematically create relationships between all memories:

1. **Code → Technology**: DEPENDS_ON for imports and usage
2. **Function → CodeFile**: CONTAINS (reverse: PART_OF)
3. **Feature → CodeFile**: IMPLEMENTS
4. **Feature → Function**: IMPLEMENTS
5. **Person → CodeFile**: CREATED_BY (from git history)
6. **Decision → Feature**: INFLUENCES
7. **Decision → Technology**: INFLUENCES (technology choices)
8. **Environment → Technology**: USES
9. **CodeFile → CodeFile**: DEPENDS_ON (imports)
10. **Function → Function**: DEPENDS_ON (calls)

#### Relationship Strength Calculation

Assign strength values (0.1-1.0) based on:
- **1.0**: Direct containment, explicit implementation
- **0.8-0.9**: Strong functional dependency, critical path
- **0.5-0.7**: Moderate coupling, shared concerns
- **0.2-0.4**: Weak association, tangential relationship
- **0.1**: Minimal connection, distant relationship

### Phase 8: Historical Context Analysis

#### Git History Mining

Analyze git log for insights:

**Commit Pattern Analysis:**
```bash
# Identify frequently changed files
git log --name-only --format="" | sort | uniq -c | sort -rn

# Identify file co-change patterns
git log --name-only --format="%H" | awk '/^$/{next} {if(NR==1){commit=$1}else{print commit" "$1}}'

# Analyze commit message patterns
git log --format="%s" | grep -E "(fix|feat|refactor|docs)"
```

Create memories for:
- **Hotspot Files**: Frequently modified files (potential complexity indicators)
- **Co-change Patterns**: Files often modified together (coupling indicators)
- **Major Refactors**: Significant restructuring events
- **Bug Fix Patterns**: Common bug locations

#### Temporal Observations

Add temporal context to memories:
```json
{
  "observations": [
    {
      "content": "File created in initial commit",
      "timestamp": "2023-01-15T10:00:00Z"
    },
    {
      "content": "Major refactor completed",
      "timestamp": "2023-08-20T14:30:00Z"
    },
    {
      "content": "Last modified 3 months ago - potentially stale",
      "timestamp": "2024-07-10T09:15:00Z"
    }
  ]
}
```

### Phase 9: Quality and Metrics

#### Code Quality Assessment

For each CodeFile, add observations about:
- **Complexity**: Estimated cyclomatic complexity
- **Size**: Lines of code, file size
- **Test Coverage**: If determinable from test files
- **Documentation**: Presence and quality of comments
- **Code Smells**: Identified anti-patterns or issues

#### Dependency Health

Assess technology dependencies:
- **Version Currency**: How up-to-date are dependencies?
- **Security**: Known vulnerabilities (if tooling available)
- **Maintenance**: Last update date, active maintenance
- **Alternatives**: Other options that were/could be considered

### Phase 10: Documentation Integration

#### Extract Documentation Insights

From README, docs, wikis:
- **Setup Instructions**: Create Task nodes for setup steps
- **Architecture Diagrams**: Translate to Decision and Technology relationships
- **API Documentation**: Create Feature nodes for documented endpoints
- **Deployment Guides**: Create Environment and Task memories

#### Create Documentation Memories

```json
{
  "name": "Project README",
  "memoryType": "codefile",
  "metadata": {
    "path": "README.md",
    "language": "markdown",
    "purpose": "project documentation"
  },
  "observations": [
    {
      "content": "Documents [key aspects of project]",
      "context": "Documentation review"
    }
  ]
}
```

### Phase 11: Validation and Completeness Check

#### Memory Coverage Audit

Verify you've created memories for:
- [ ] All primary programming languages (1+ per language)
- [ ] All major frameworks and libraries (5-20 depending on project size)
- [ ] All key contributors (3-10 people)
- [ ] All deployment environments (2-5 typically)
- [ ] All significant code files (10-100+ depending on project size)
- [ ] All major features (5-20 user-facing features)
- [ ] All architectural decisions identifiable from code/docs (3-10+)
- [ ] Core functions in critical paths (20-100+ depending on complexity)

#### Relationship Density Check

Ensure rich connectivity:
- Each CodeFile should have 3-10+ relationships
- Each Feature should connect to 2-5+ implementations
- Each Decision should influence 2-10+ artifacts
- Each Person should have created/modified 5-50+ artifacts
- Each Technology should be used by 3-20+ files

#### Quality Validation

Check each memory has:
- [ ] Descriptive, unique name
- [ ] Appropriate memoryType
- [ ] Rich metadata (3-8 properties)
- [ ] At least 1 observation
- [ ] At least 2 relationships (except root nodes)

### Phase 12: Summary Report Generation

Create a comprehensive summary as observations on a special "Project" node:

```json
{
  "name": "Project Summary",
  "memoryType": "project",
  "metadata": {
    "initialized": "timestamp",
    "totalFiles": "count",
    "totalFunctions": "count",
    "totalFeatures": "count",
    "primaryLanguage": "language",
    "primaryFramework": "framework",
    "teamSize": "contributor count"
  },
  "observations": [
    {
      "content": "Project initialization complete. Created X nodes and Y relationships.",
      "context": "Memory system initialization"
    },
    {
      "content": "Key technologies: [list]",
      "context": "Technology stack"
    },
    {
      "content": "Core features: [list]",
      "context": "Feature summary"
    },
    {
      "content": "Architecture patterns: [patterns identified]",
      "context": "Architectural analysis"
    },
    {
      "content": "Potential areas of technical debt: [areas]",
      "context": "Quality assessment"
    }
  ]
}
```

## Execution Strategy

### For Small Projects (< 50 files)
- Complete analysis: Create memories for all files and functions
- Detailed relationships: Map all dependencies
- Timeline: 30-60 minutes of thorough analysis

### For Medium Projects (50-500 files)
- Selective analysis: Focus on core business logic, entry points, and critical paths
- Key relationships: Map primary dependencies and feature implementations
- Timeline: 1-3 hours of focused analysis

### For Large Projects (500+ files)
- Phased approach: Start with high-priority areas
- Iterative expansion: Add detail in subsequent sessions
- Timeline: Initial pass 2-4 hours, continue over multiple sessions

## Iterative Enhancement Protocol

After initial creation:

1. **Week 1-2**: Monitor for missing context during development
2. **Week 3-4**: Add memories for newly discovered patterns
3. **Month 2+**: Refine relationship strengths based on actual usage
4. **Ongoing**: Update as project evolves

## Common Pitfalls to Avoid

1. **Over-Granularity**: Don't create Function nodes for every tiny helper
2. **Under-Connection**: Every memory should connect to the graph
3. **Stale Metadata**: Include temporal context to know when info is from
4. **Duplicate Memories**: Search before creating to avoid duplicates
5. **Generic Relationships**: Use specific relationship types
6. **Missing Observations**: Every memory needs context
7. **Weak Relationships**: Include strength and confidence
8. **Ignoring History**: Git history provides valuable context

## Success Criteria

A successful initialization includes:

✅ **Comprehensive Coverage**: All major project components represented
✅ **Rich Connectivity**: Dense relationship network between memories
✅ **Quality Metadata**: Detailed context in all memory nodes
✅ **Temporal Tracking**: Creation and modification times recorded
✅ **Actionable Insights**: Observations that provide real value
✅ **Queryable Structure**: Can answer questions about the project through queries
✅ **Evolution Ready**: Structure supports ongoing updates and additions

## Example Queries to Test Completeness

After initialization, you should be able to answer:

1. "What are all the features in this project?"
2. "Which files implement user authentication?"
3. "What technologies does this project depend on?"
4. "Who are the main contributors to the codebase?"
5. "What architectural decisions have been made?"
6. "Which files are most complex or frequently changed?"
7. "What are the relationships between Feature X and the code?"
8. "Which bugs are currently open and who's assigned?"

If you can't answer these through memory queries, continue adding memories and relationships.

## Final Steps

1. **Verify Database**: Confirm all memories stored successfully
2. **Test Queries**: Run sample queries to validate structure
3. **Document Gaps**: Note areas needing more detail
4. **Plan Next Steps**: Identify priorities for ongoing memory maintenance
5. **Create Initialization Report**: Summarize what was created and next actions

Remember: This is a living memory system. Initial creation provides the foundation, but the real value comes from continuous updates as the project evolves.
      "content": "File contains [key functionality]",
      "context": "Initial project analysis"
    }
  ],
  "relations": [
    {
      "targetId": "technology_node_id",
      "relation": "DEPENDS_ON",
      "properties": {
        "strength": 0.9,
        "confidence": "high"
      }
    }
  ]
}
```

#### Function-Level Analysis

For key functions/methods in priority files:

1. **API Endpoints**: Routes, handlers, middleware
2. **Database Operations**: CRUD operations, queries
3. **Business Logic**: Core algorithms, calculations
4. **Utility Functions**: Helpers, formatters, validators

**Function Memory Template:**
```json
{
  "name": "functionName",
  "memoryType": "function",
  "metadata": {
    "signature": "function signature",
    "returnType": "return type",
    "complexity": "estimated complexity",
    "purpose": "what the function does"
  },
  "observations": [
    {
      "content": "Function implements [specific behavior]",
      "context": "Code analysis"
    }
  ],
  "relations": [
    {
      "targetId": "containing_file_id",
      "relation": "CONTAINED_IN",
      "properties": {"strength": 1.0}
    }
  ]
}
```

### Phase 4: Feature and Requirement Discovery

#### Feature Identification

Identify features from:
- User-facing functionality in the UI
- API endpoints and their purposes
- Documentation descriptions
- Test descriptions
- Git commit messages mentioning features

**Feature Memory Template:**
```json
{
  "name": "User Authentication",
  "memoryType": "feature",
  "metadata": {
    "status": "implemented/in-progress/planned",
    "priority": "inferred priority",
    "complexity": "estimated complexity"
  },
  "observations": [
    {
      "content": "Enables users to [specific capability]",
      "context": "Feature analysis"
    }
  ]
}
```

#### Link Features to Implementation

Create IMPLEMENTS relationships:
- Feature → CodeFiles that implement it
- Feature → Functions that provide the functionality
- Feature → Technologies that enable it

### Phase 5: Issue and Decision Discovery

#### Bug Identification

Look for bugs in:
- Issue trackers (if accessible)
- TODO/FIXME comments in code
- Git commit messages mentioning fixes
- Test files describing failing scenarios

#### Decision Archaeology

Identify architectural decisions from:
- Documentation (ADRs if present)
- Code comments explaining choices
- Git commit messages explaining rationale
- Configuration file choices
- Technology selection patterns

**Decision Memory Template:**
```json
{
  "name": "Use PostgreSQL for data storage",
  "memoryType": "decision",
  "metadata": {
    "category": "architecture",
    "impact": "project",
    "reversible": false,
    "rationale": "inferred or documented reason"
  },
  "observations": [
    {
