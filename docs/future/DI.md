# Dependency Injection Architecture for Iris MCP

**Status**: Proposed
**Created**: 2025-10-10
**Author**: System Analysis

## Executive Summary

This document proposes a comprehensive Dependency Injection (DI) architecture for Iris MCP to enable proper unit testing with mocked dependencies. The current architecture has tight coupling between modules, making isolated unit testing impossible without spawning real child processes, creating real databases, and performing real filesystem operations.

## Problem Statement

### Current Architecture Issues

1. **Hard-coded External Dependencies**
   - `child_process.spawn()` called directly (can't mock process spawning)
   - `fs` operations scattered throughout modules (can't mock filesystem)
   - `better-sqlite3` database instantiated directly (can't mock SQLite)
   - Static methods used for critical operations (fragile vitest mocking)

2. **Tight Coupling**
   - `SessionManager` directly calls `ClaudeProcess.initializeSessionFile()` (static method)
   - `SessionManager` instantiates `SessionStore` internally
   - `ClaudeProcessPool` instantiates `ClaudeProcess` directly
   - `NotificationQueue` and `SessionStore` instantiate databases directly

3. **Testing Challenges**
   - Unit tests create real SQLite databases (integration test, not unit test)
   - Unit tests rely on `vi.spyOn()` for static methods (fragile)
   - No way to test without filesystem access
   - Cannot isolate business logic from I/O operations

## Design Principles

The proposed architecture follows these principles:

1. **Dependency Inversion Principle**: Depend on abstractions, not concretions
2. **Single Responsibility**: Each module has one reason to change
3. **Interface Segregation**: Small, focused interfaces
4. **Explicit Dependencies**: All dependencies injected via constructor
5. **Testability First**: Every module can be unit tested in isolation

## Proposed Architecture

### Layer Overview

```
┌─────────────────────────────────────────────────────────┐
│                  MCP Transport Layer                     │
│                    (index.ts)                            │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│              Business Logic Layer                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │         IrisOrchestrator (already DI!)          │   │
│  └──┬──────────────────────────────────────────┬───┘   │
│     │                                           │       │
│  ┌──▼──────────────┐               ┌───────────▼────┐  │
│  │ SessionManager  │               │ ProcessPool     │  │
│  │  (needs DI)     │               │  (needs DI)     │  │
│  └─────────────────┘               └─────────────────┘  │
└─────────────────────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│            Infrastructure Layer (Interfaces)             │
│                                                          │
│  ISessionInitializer  ISessionRepository                │
│  IProcessSpawner      IDatabaseProvider                 │
│  IFileSystem          IConfigProvider                   │
│                                                          │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│         Implementation Layer (Concrete)                  │
│                                                          │
│  ClaudeSessionInitializer  SessionStore                 │
│  NodeProcessSpawner        SqliteDatabase               │
│  NodeFileSystem            JsonConfigProvider           │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## Module-by-Module DI Design

### 1. SessionManager

**Current Problems**:
- Calls `ClaudeProcess.initializeSessionFile()` (static method)
- Instantiates `SessionStore` internally
- No dependency injection

**Proposed Interface**:

```typescript
// src/session/interfaces/session-initializer.interface.ts
export interface ISessionInitializer {
  /**
   * Initialize a session file for a team
   * @param teamConfig - Team configuration
   * @param sessionId - UUID for session
   * @param timeout - Initialization timeout in ms
   */
  initializeSessionFile(
    teamConfig: TeamConfig,
    sessionId: string,
    timeout: number
  ): Promise<void>;
}

// src/session/interfaces/session-repository.interface.ts
export interface ISessionRepository {
  create(fromTeam: string, toTeam: string, sessionId: string): SessionInfo;
  getByTeamPair(fromTeam: string, toTeam: string): SessionInfo | null;
  getBySessionId(sessionId: string): SessionInfo | null;
  list(filters?: SessionFilters): SessionInfo[];
  updateLastUsed(sessionId: string): void;
  incrementMessageCount(sessionId: string, count?: number): void;
  resetMessageCount(sessionId: string): void;
  updateStatus(sessionId: string, status: SessionStatus): void;
  delete(sessionId: string): void;
  getStats(): SessionStats;
  close(): void;
}

// src/session/interfaces/path-validator.interface.ts
export interface IPathValidator {
  validateProjectPath(path: string): void;
  validateSecureProjectPath(path: string): void;
  getSessionFilePath(projectPath: string, sessionId: string): string;
}
```

**Refactored SessionManager**:

```typescript
// src/session/session-manager.ts
export class SessionManager {
  constructor(
    private teamsConfig: TeamsConfig,
    private sessionRepository: ISessionRepository,
    private sessionInitializer: ISessionInitializer,
    private pathValidator: IPathValidator,
    private dbPath?: string
  ) {}

  async initialize(): Promise<void> {
    // Validate all team paths
    for (const [teamName, teamConfig] of Object.entries(this.teamsConfig.teams)) {
      this.pathValidator.validateSecureProjectPath(teamConfig.path);
    }

    // Pre-initialize sessions using injected initializer
    for (const [teamName, teamConfig] of Object.entries(this.teamsConfig.teams)) {
      const existing = this.sessionRepository.getByTeamPair(null, teamName);

      if (!existing || !this.sessionFileExists(teamConfig.path, existing.sessionId)) {
        const sessionId = generateSecureUUID();
        await this.sessionInitializer.initializeSessionFile(
          teamConfig,
          sessionId,
          this.teamsConfig.settings.sessionInitTimeout
        );
        this.sessionRepository.create(null, teamName, sessionId);
      }
    }
  }

  // ... rest of methods use this.sessionRepository instead of this.store
}
```

**Production Implementation**:

```typescript
// src/session/implementations/claude-session-initializer.ts
export class ClaudeSessionInitializer implements ISessionInitializer {
  constructor(
    private processSpawner: IProcessSpawner,
    private fileSystem: IFileSystem
  ) {}

  async initializeSessionFile(
    teamConfig: TeamConfig,
    sessionId: string,
    timeout: number
  ): Promise<void> {
    // Use injected processSpawner instead of direct spawn()
    return ClaudeProcess.initializeSessionFile(teamConfig, sessionId, timeout);
  }
}

// src/session/implementations/session-store-adapter.ts
export class SessionStoreAdapter implements ISessionRepository {
  private store: SessionStore;

  constructor(dbPath?: string) {
    this.store = new SessionStore(dbPath);
  }

  create(fromTeam: string, toTeam: string, sessionId: string): SessionInfo {
    return this.store.create(fromTeam, toTeam, sessionId);
  }

  // ... delegate all methods to this.store
}
```

**Unit Test with Mocks**:

```typescript
// tests/unit/session/session-manager.test.ts
describe('SessionManager', () => {
  let manager: SessionManager;
  let mockRepository: ISessionRepository;
  let mockInitializer: ISessionInitializer;
  let mockPathValidator: IPathValidator;

  beforeEach(() => {
    // Create pure mocks - no real database, no real processes
    mockRepository = {
      create: vi.fn().mockReturnValue({ id: 1, sessionId: 'test-uuid' }),
      getByTeamPair: vi.fn().mockReturnValue(null),
      // ... all other methods mocked
    };

    mockInitializer = {
      initializeSessionFile: vi.fn().mockResolvedValue(undefined),
    };

    mockPathValidator = {
      validateProjectPath: vi.fn(),
      validateSecureProjectPath: vi.fn(),
      getSessionFilePath: vi.fn().mockReturnValue('/fake/path'),
    };

    // Pure DI - completely isolated unit test
    manager = new SessionManager(
      testConfig,
      mockRepository,
      mockInitializer,
      mockPathValidator
    );
  });

  it('should create session without spawning real processes', async () => {
    await manager.initialize();

    expect(mockInitializer.initializeSessionFile).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringMatching(/^[0-9a-f-]+$/),
      30000
    );
    expect(mockRepository.create).toHaveBeenCalled();
  });
});
```

---

### 2. ClaudeProcess

**Current Problems**:
- Directly calls `spawn()` from `child_process`
- Directly accesses `fs.existsSync()`
- Static method `initializeSessionFile()` is untestable

**Proposed Interface**:

```typescript
// src/process-pool/interfaces/process-spawner.interface.ts
export interface IProcessSpawner {
  /**
   * Spawn a child process
   * @returns Process handle with stdio streams and lifecycle methods
   */
  spawn(
    command: string,
    args: string[],
    options: SpawnOptions
  ): IChildProcess;
}

export interface IChildProcess {
  pid?: number;
  stdin: IWritableStream;
  stdout: IReadableStream;
  stderr: IReadableStream;

  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;

  kill(signal?: string): void;
}

export interface IWritableStream {
  write(data: string): boolean;
  end(): void;
}

export interface IReadableStream {
  on(event: 'data', listener: (data: Buffer) => void): this;
}
```

**Refactored ClaudeProcess**:

```typescript
// src/process-pool/claude-process.ts
export class ClaudeProcess extends EventEmitter {
  private process: IChildProcess | null = null;

  constructor(
    private teamName: string,
    private teamConfig: TeamConfig,
    private idleTimeout: number,
    private sessionId: string | undefined,
    private processSpawner: IProcessSpawner // INJECTED!
  ) {
    super();
  }

  async spawn(): Promise<void> {
    // Build args...
    const args = ['--resume', this.sessionId, '--print', '--verbose', ...];

    // Use injected spawner instead of direct spawn()
    this.process = this.processSpawner.spawn('claude', args, {
      cwd: this.teamConfig.path,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    // Set up event handlers on this.process (interface)
    this.process.on('error', (error) => this.handleProcessError(error));
    this.process.on('exit', (code, signal) => this.handleProcessExit(code, signal));

    // ... rest of spawn logic
  }

  // ... rest of methods unchanged
}
```

**Production Implementation**:

```typescript
// src/process-pool/implementations/node-process-spawner.ts
import { spawn as nodeSpawn, ChildProcess } from 'child_process';

export class NodeProcessSpawner implements IProcessSpawner {
  spawn(command: string, args: string[], options: SpawnOptions): IChildProcess {
    const proc = nodeSpawn(command, args, options);
    return new NodeChildProcessAdapter(proc);
  }
}

class NodeChildProcessAdapter implements IChildProcess {
  constructor(private proc: ChildProcess) {}

  get pid() { return this.proc.pid; }
  get stdin() { return this.proc.stdin as any; }
  get stdout() { return this.proc.stdout as any; }
  get stderr() { return this.proc.stderr as any; }

  on(event: any, listener: any) {
    this.proc.on(event, listener);
    return this;
  }

  // ... delegate all methods
}
```

**Unit Test with Mock**:

```typescript
describe('ClaudeProcess', () => {
  let process: ClaudeProcess;
  let mockSpawner: IProcessSpawner;
  let mockChildProcess: IChildProcess;

  beforeEach(() => {
    mockChildProcess = createMockChildProcess();

    mockSpawner = {
      spawn: vi.fn().mockReturnValue(mockChildProcess),
    };

    process = new ClaudeProcess(
      'test-team',
      testConfig,
      30000,
      'session-123',
      mockSpawner // INJECTED MOCK!
    );
  });

  it('should spawn process with correct arguments', async () => {
    await process.spawn();

    expect(mockSpawner.spawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--resume', 'session-123']),
      expect.objectContaining({ cwd: testConfig.path })
    );
  });

  it('should handle stdout data', async () => {
    await process.spawn();

    // Simulate Claude sending init message
    mockChildProcess.stdout.emit('data', Buffer.from('{"type":"system","subtype":"init"}\n'));

    // No real process spawned - pure unit test!
  });
});

function createMockChildProcess(): IChildProcess {
  const stdout = new EventEmitter() as any;
  const stderr = new EventEmitter() as any;
  const stdin = { write: vi.fn(), end: vi.fn() };

  return {
    pid: 12345,
    stdin,
    stdout,
    stderr,
    on: vi.fn().mockReturnThis(),
    once: vi.fn().mockReturnThis(),
    removeListener: vi.fn().mockReturnThis(),
    kill: vi.fn(),
  };
}
```

---

### 3. ClaudeProcessPool

**Current Problems**:
- Directly instantiates `ClaudeProcess`
- Tight coupling to concrete implementation

**Proposed Interface**:

```typescript
// src/process-pool/interfaces/process-factory.interface.ts
export interface IProcessFactory {
  /**
   * Create a new ClaudeProcess instance
   */
  createProcess(
    teamName: string,
    teamConfig: TeamConfig,
    idleTimeout: number,
    sessionId: string
  ): ClaudeProcess;
}
```

**Refactored ClaudeProcessPool**:

```typescript
// src/process-pool/pool-manager.ts
export class ClaudeProcessPool extends EventEmitter {
  constructor(
    private configManager: TeamsConfigManager,
    private config: ProcessPoolConfig,
    private processFactory: IProcessFactory // INJECTED!
  ) {
    super();
    this.startHealthCheck();
  }

  async getOrCreateProcess(
    teamName: string,
    sessionId: string,
    fromTeam: string = null
  ): Promise<ClaudeProcess> {
    // ... check existing process logic

    // Create new process using injected factory
    const process = this.processFactory.createProcess(
      teamName,
      teamConfig,
      teamConfig.idleTimeout || this.config.idleTimeout,
      sessionId
    );

    // ... rest of setup
  }
}
```

**Production Implementation**:

```typescript
// src/process-pool/implementations/claude-process-factory.ts
export class ClaudeProcessFactory implements IProcessFactory {
  constructor(private processSpawner: IProcessSpawner) {}

  createProcess(
    teamName: string,
    teamConfig: TeamConfig,
    idleTimeout: number,
    sessionId: string
  ): ClaudeProcess {
    return new ClaudeProcess(
      teamName,
      teamConfig,
      idleTimeout,
      sessionId,
      this.processSpawner
    );
  }
}
```

**Unit Test with Mock**:

```typescript
describe('ClaudeProcessPool', () => {
  let pool: ClaudeProcessPool;
  let mockFactory: IProcessFactory;
  let mockProcess: ClaudeProcess;

  beforeEach(() => {
    mockProcess = {
      spawn: vi.fn().mockResolvedValue(undefined),
      getMetrics: vi.fn().mockReturnValue({ status: 'idle' }),
      on: vi.fn(),
      // ... other methods
    } as any;

    mockFactory = {
      createProcess: vi.fn().mockReturnValue(mockProcess),
    };

    pool = new ClaudeProcessPool(
      mockConfigManager,
      testConfig,
      mockFactory // INJECTED MOCK!
    );
  });

  it('should create process using factory', async () => {
    const process = await pool.getOrCreateProcess('test-team', 'session-123');

    expect(mockFactory.createProcess).toHaveBeenCalledWith(
      'test-team',
      expect.any(Object),
      30000,
      'session-123'
    );
    expect(mockProcess.spawn).toHaveBeenCalled();
  });
});
```

---

### 4. SessionStore & NotificationQueue

**Current Problems**:
- Directly instantiate `better-sqlite3` Database
- Direct filesystem operations

**Proposed Interface**:

```typescript
// src/infrastructure/interfaces/database.interface.ts
export interface IDatabaseConnection {
  prepare(sql: string): IDatabaseStatement;
  exec(sql: string): void;
  pragma(pragma: string): void;
  close(): void;
  transaction<T>(fn: () => T): () => T;
}

export interface IDatabaseStatement {
  run(...params: any[]): { lastInsertRowid: number | bigint; changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

export interface IDatabaseProvider {
  connect(path: string): IDatabaseConnection;
}

// src/infrastructure/interfaces/filesystem.interface.ts
export interface IFileSystem {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  readFileSync(path: string, encoding: string): string;
  unlinkSync(path: string): void;
}
```

**Refactored SessionStore**:

```typescript
// src/session/session-store.ts
export class SessionStore implements ISessionRepository {
  private db: IDatabaseConnection;

  constructor(
    dbPath: string,
    private dbProvider: IDatabaseProvider,
    private fs: IFileSystem
  ) {
    // Use injected filesystem
    const dataDir = dirname(dbPath);
    if (!this.fs.existsSync(dataDir)) {
      this.fs.mkdirSync(dataDir, { recursive: true });
    }

    // Use injected database provider
    this.db = this.dbProvider.connect(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initializeSchema();
  }

  create(fromTeam: string, toTeam: string, sessionId: string): SessionInfo {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO team_sessions (from_team, to_team, session_id, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(fromTeam, toTeam, sessionId, now, now);
    // ... rest
  }

  // ... all methods use this.db (interface) instead of direct Database
}
```

**Production Implementation**:

```typescript
// src/infrastructure/implementations/sqlite-database-provider.ts
import Database from 'better-sqlite3';

export class SqliteDatabaseProvider implements IDatabaseProvider {
  connect(path: string): IDatabaseConnection {
    const db = new Database(path);
    return new SqliteDatabaseAdapter(db);
  }
}

class SqliteDatabaseAdapter implements IDatabaseConnection {
  constructor(private db: Database.Database) {}

  prepare(sql: string): IDatabaseStatement {
    const stmt = this.db.prepare(sql);
    return new SqliteStatementAdapter(stmt);
  }

  // ... delegate all methods
}

// src/infrastructure/implementations/node-filesystem.ts
import * as fs from 'fs';

export class NodeFileSystem implements IFileSystem {
  existsSync(path: string): boolean {
    return fs.existsSync(path);
  }

  mkdirSync(path: string, options?: { recursive?: boolean }): void {
    fs.mkdirSync(path, options);
  }

  // ... all fs methods
}
```

**Unit Test with Mock**:

```typescript
describe('SessionStore', () => {
  let store: SessionStore;
  let mockDbProvider: IDatabaseProvider;
  let mockDb: IDatabaseConnection;
  let mockFs: IFileSystem;

  beforeEach(() => {
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        run: vi.fn().mockReturnValue({ lastInsertRowid: 1, changes: 1 }),
        get: vi.fn(),
        all: vi.fn().mockReturnValue([]),
      }),
      exec: vi.fn(),
      pragma: vi.fn(),
      close: vi.fn(),
      transaction: vi.fn((fn) => fn),
    };

    mockDbProvider = {
      connect: vi.fn().mockReturnValue(mockDb),
    };

    mockFs = {
      existsSync: vi.fn().mockReturnValue(true),
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };

    store = new SessionStore(
      './test.db',
      mockDbProvider,
      mockFs
    );
  });

  it('should create session without real database', () => {
    const session = store.create(null, 'team-a', 'uuid-123');

    expect(mockDb.prepare).toHaveBeenCalled();
    expect(session.sessionId).toBe('uuid-123');
    // No real SQLite database created!
  });
});
```

---

### 5. TeamsConfigManager

**Current Problems**:
- Direct filesystem access
- Singleton pattern (global state)

**Proposed Interface**:

```typescript
// src/config/interfaces/config-provider.interface.ts
export interface IConfigProvider {
  load(path: string): TeamsConfig;
  watch(path: string, callback: (config: TeamsConfig) => void): void;
}
```

**Refactored TeamsConfigManager**:

```typescript
// src/config/teams-config.ts
export class TeamsConfigManager {
  private config: TeamsConfig | null = null;

  constructor(
    private configPath: string,
    private configProvider: IConfigProvider,
    private fs: IFileSystem
  ) {}

  load(): TeamsConfig {
    if (!this.fs.existsSync(this.configPath)) {
      throw new ConfigurationError(`Config file not found: ${this.configPath}`);
    }

    this.config = this.configProvider.load(this.configPath);

    // Validate team paths
    for (const [name, team] of Object.entries(this.config.teams)) {
      if (!this.fs.existsSync(team.path)) {
        logger.warn(`Team "${name}" path does not exist: ${team.path}`);
      }
    }

    return this.config;
  }
}
```

---

## Factory Pattern for Composition

**Root Factory / Composition Root**:

```typescript
// src/di/container.ts
export class IrisContainer {
  /**
   * Create production instance with real dependencies
   */
  static createProduction(): IrisMcpServer {
    // Infrastructure layer
    const fs = new NodeFileSystem();
    const dbProvider = new SqliteDatabaseProvider();
    const processSpawner = new NodeProcessSpawner();
    const configProvider = new JsonConfigProvider(fs);

    // Config
    const configManager = new TeamsConfigManager(
      process.env.IRIS_CONFIG_PATH || './teams.json',
      configProvider,
      fs
    );
    const config = configManager.load();

    // Session layer
    const sessionRepository = new SessionStoreAdapter(
      './data/team-sessions.db',
      dbProvider,
      fs
    );
    const pathValidator = new PathValidator(fs);
    const sessionInitializer = new ClaudeSessionInitializer(processSpawner, fs);

    const sessionManager = new SessionManager(
      config,
      sessionRepository,
      sessionInitializer,
      pathValidator
    );

    // Process pool
    const processFactory = new ClaudeProcessFactory(processSpawner);
    const processPool = new ClaudeProcessPool(
      configManager,
      config.settings,
      processFactory
    );

    // Orchestrator
    const iris = new IrisOrchestrator(sessionManager, processPool);

    // Notification queue
    const notificationQueue = new NotificationQueue(
      './data/notifications.db',
      dbProvider,
      fs
    );

    return new IrisMcpServer(
      configManager,
      sessionManager,
      processPool,
      notificationQueue,
      iris
    );
  }

  /**
   * Create test instance with mock dependencies
   */
  static createTest(mocks: Partial<TestMocks>): IrisMcpServer {
    const fs = mocks.fs || createMockFileSystem();
    const dbProvider = mocks.dbProvider || createMockDatabaseProvider();
    const processSpawner = mocks.processSpawner || createMockProcessSpawner();

    // ... compose with mocks
  }
}
```

**Updated index.ts**:

```typescript
// src/index.ts
class IrisMcpServer {
  // Dependencies now injected via constructor
  constructor(
    private configManager: TeamsConfigManager,
    private sessionManager: SessionManager,
    private processPool: ClaudeProcessPool,
    private notificationQueue: NotificationQueue,
    private iris: IrisOrchestrator
  ) {
    this.server = new Server({ name: "@iris-mcp/server", version: "1.0.0" });
    this.setupHandlers();
    this.setupEventListeners();
  }

  async run(): Promise<void> {
    await this.sessionManager.initialize();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Start the server using factory
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = IrisContainer.createProduction();
  server.run().catch((error) => {
    logger.error('Fatal error', error);
    process.exit(1);
  });
}
```

---

## Migration Strategy

### Phase 1: Infrastructure Interfaces (Week 1)
1. Create interface definitions in `src/infrastructure/interfaces/`
2. Create production implementations in `src/infrastructure/implementations/`
3. No breaking changes - just new files

### Phase 2: SessionStore & NotificationQueue (Week 2)
1. Refactor `SessionStore` to accept `IDatabaseProvider` and `IFileSystem`
2. Refactor `NotificationQueue` similarly
3. Update unit tests to use mocks
4. Maintain backward compatibility with default constructors

### Phase 3: ClaudeProcess (Week 3)
1. Create `IProcessSpawner` interface
2. Refactor `ClaudeProcess` to accept `IProcessSpawner`
3. Create `NodeProcessSpawner` implementation
4. Update unit tests

### Phase 4: SessionManager (Week 4)
1. Create `ISessionInitializer` and `ISessionRepository` interfaces
2. Refactor `SessionManager` to accept dependencies
3. Update all call sites
4. Update unit tests

### Phase 5: ClaudeProcessPool (Week 5)
1. Create `IProcessFactory` interface
2. Refactor pool to use factory
3. Update integration tests

### Phase 6: Composition Root (Week 6)
1. Create `IrisContainer` factory
2. Update `index.ts` to use factory
3. Comprehensive integration testing
4. Documentation updates

---

## Testing Strategy

### Unit Tests (Fully Isolated)
```typescript
// Example: test/unit/session/session-manager.test.ts
describe('SessionManager (unit)', () => {
  it('should handle session creation logic', async () => {
    const mockRepo = createMockRepository();
    const mockInit = createMockInitializer();

    const manager = new SessionManager(config, mockRepo, mockInit, mockValidator);
    await manager.createSession('team-a', 'team-b');

    // Pure business logic test - no I/O!
    expect(mockRepo.create).toHaveBeenCalledWith('team-a', 'team-b', expect.any(String));
  });
});
```

### Integration Tests (Real Dependencies)
```typescript
// tests/integration/session/session-manager.test.ts
describe('SessionManager (integration)', () => {
  it('should create real session files', async () => {
    // Use production implementations
    const fs = new NodeFileSystem();
    const dbProvider = new SqliteDatabaseProvider();
    const processSpawner = new NodeProcessSpawner();

    const manager = new SessionManager(
      config,
      new SessionStoreAdapter(testDbPath, dbProvider, fs),
      new ClaudeSessionInitializer(processSpawner, fs),
      new PathValidator(fs)
    );

    await manager.initialize();

    // Real end-to-end test
    expect(fs.existsSync(sessionFilePath)).toBe(true);
  });
});
```

---

## Benefits

1. **True Unit Testing**: Test business logic in complete isolation
2. **Faster Tests**: No real processes, databases, or filesystem operations
3. **Deterministic Tests**: Mocks provide predictable behavior
4. **Better Design**: Explicit dependencies reveal coupling
5. **Easier Debugging**: Mock implementations can log interactions
6. **Refactoring Safety**: Interfaces provide stable contracts
7. **Production Safety**: Integration tests validate real implementations

---

## Backward Compatibility

All refactoring maintains backward compatibility:

```typescript
// src/session/session-manager.ts
export class SessionManager {
  constructor(
    teamsConfig: TeamsConfig,
    sessionRepository?: ISessionRepository,
    sessionInitializer?: ISessionInitializer,
    pathValidator?: IPathValidator
  ) {
    // Default to production implementations if not provided
    this.sessionRepository = sessionRepository || new SessionStoreAdapter();
    this.sessionInitializer = sessionInitializer || new ClaudeSessionInitializer(
      new NodeProcessSpawner(),
      new NodeFileSystem()
    );
    this.pathValidator = pathValidator || new PathValidator(new NodeFileSystem());
  }
}
```

---

## Directory Structure

```
src/
├── infrastructure/
│   ├── interfaces/
│   │   ├── database.interface.ts
│   │   ├── filesystem.interface.ts
│   │   ├── process-spawner.interface.ts
│   │   └── config-provider.interface.ts
│   └── implementations/
│       ├── sqlite-database-provider.ts
│       ├── node-filesystem.ts
│       ├── node-process-spawner.ts
│       └── json-config-provider.ts
├── session/
│   ├── interfaces/
│   │   ├── session-initializer.interface.ts
│   │   ├── session-repository.interface.ts
│   │   └── path-validator.interface.ts
│   ├── implementations/
│   │   ├── claude-session-initializer.ts
│   │   ├── session-store-adapter.ts
│   │   └── path-validator.ts
│   ├── session-manager.ts
│   └── session-store.ts
├── process-pool/
│   ├── interfaces/
│   │   └── process-factory.interface.ts
│   ├── implementations/
│   │   └── claude-process-factory.ts
│   ├── pool-manager.ts
│   └── claude-process.ts
├── di/
│   ├── container.ts
│   └── test-helpers.ts
└── index.ts
```

---

## Conclusion

This DI architecture enables:
- **Pure unit tests** with no real I/O operations
- **Clear separation** between business logic and infrastructure
- **Testable code** at every layer
- **Maintainable design** with explicit dependencies
- **Production safety** through comprehensive integration tests

The migration can be done incrementally without breaking existing functionality, making it a low-risk, high-value refactoring.
