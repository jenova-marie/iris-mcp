# Neo4j Project Development Memory System

A comprehensive system for storing and querying project development memories using Neo4j graph database with the MCP Neo4j Memory Server.

## Overview

This system models software development artifacts as interconnected nodes in a Neo4j graph database, enabling AI assistants to maintain persistent, queryable memory of project evolution, decisions, and relationships.

## Architecture

### Core Components

- **Neo4j Database**: Graph database storing development artifacts as nodes and relationships
- **MCP Memory Server**: [@sylweriusz/mcp-neo4j-memory-server](https://github.com/sylweriusz/mcp-neo4j-memory-server) providing unified memory operations
- **Vector Search**: Semantic search capabilities using 384-dimensional embeddings
- **Graph Traversal**: Navigate relationships between artifacts with depth control

### Node Types

The system models these primary development artifacts:

- **CodeFile**: Source code files, configurations, documentation
- **Function**: Methods, classes, components within code files
- **Feature**: User stories, requirements, capabilities
- **Bug**: Issues, defects, problems to resolve
- **Decision**: Architecture choices, design decisions, trade-offs
- **Commit**: Version control commits linking changes
- **Task**: Work items, todos, development activities
- **Person**: Developers, stakeholders, contributors
- **Technology**: Tools, frameworks, libraries used
- **Environment**: Deployment targets, configurations

### Relationship Types

Connections between nodes represent various development relationships:

- **IMPLEMENTS**: Feature → CodeFile, Function → Feature
- **DEPENDS_ON**: CodeFile → Technology, Function → Function
- **FIXES**: Commit → Bug, CodeFile → Bug
- **INFLUENCES**: Decision → Feature, Person → Decision
- **CONTAINS**: CodeFile → Function, Feature → Task
- **ASSIGNED_TO**: Task → Person, Bug → Person
- **CREATED_BY**: Any node → Person
- **RELATED_TO**: General associations
- **PART_OF**: Hierarchical relationships
- **BLOCKS**: Task → Task, Bug → Feature

## Setup

### Prerequisites

```bash
# Install DozerDB with GDS plugin
docker run \
  -p 7474:7474 -p 7687:7687 \
  -v $HOME/neo4j/data:/data \
  -v $HOME/neo4j/logs:/logs \
  -v $HOME/neo4j/plugins:/plugins \
  --env NEO4J_AUTH=neo4j/password \
  --env NEO4J_dbms_security_procedures_unrestricted='gds.*' \
  graphstack/dozerdb:latest

# Install MCP server
npm install @sylweriusz/mcp-neo4j-memory-server
```

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@sylweriusz/mcp-neo4j-memory-server"],
      "env": {
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_USERNAME": "neo4j",
        "NEO4J_PASSWORD": "your-password"
      }
    }
  }
}
```

## Usage

### Session Initialization

1. Switch to project database: `database_switch` to `project-name-db`
2. Search existing memories relevant to current task
3. Store new observations and relationships as work progresses

### Memory Operations

- **Store**: Create nodes with observations and immediate relationships
- **Find**: Semantic search, exact matching, graph traversal
- **Modify**: Update nodes, add observations, create relationships
- **Switch**: Change database context for different projects

## File Structure

```
project-memory-system/
├── README.md                 # This file
├── MEMORY_MODEL.md          # Detailed modeling guide
├── MEM_PROMPT.md           # AI prompts for memory modeling
├── PROJ_PROMPT.md          # AI prompts for project evaluation
└── examples/               # Example schemas and queries
    ├── sample_nodes.cypher
    └── sample_queries.cypher
```

## Benefits

- **Persistent Context**: AI maintains understanding across sessions
- **Relationship Discovery**: Find connections between seemingly unrelated artifacts
- **Decision Tracking**: Understand why choices were made and their impact
- **Knowledge Evolution**: Track how understanding and implementation change over time
- **Semantic Search**: Find relevant information even with different terminology
- **Project Isolation**: Separate memories by project using different databases

## Best Practices

1. **Granular Observations**: Store specific, actionable information
2. **Rich Relationships**: Use appropriate relationship types with metadata
3. **Temporal Tracking**: Include timestamps and evolution context
4. **Cross-References**: Link related concepts across different artifact types
5. **Regular Updates**: Keep memory current with ongoing development

## Integration

This system integrates with:

- Claude Code for development assistance
- Version control systems for commit tracking
- Issue trackers for bug and task management
- Documentation systems for knowledge capture
- CI/CD pipelines for deployment tracking

## License

MIT License - See individual component licenses for details.
