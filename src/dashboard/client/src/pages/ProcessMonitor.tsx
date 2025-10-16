/**
 * Process Monitor Page
 * Displays all sessions (fromTeam->toTeam pairs) with status and cache viewing
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Loader2, Eye, X, Copy, Check, Terminal, MoreVertical, Moon, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { useWebSocket, type ProcessStatus, type CacheStreamData } from '../hooks/useWebSocket';

interface SessionProcessInfo {
  poolKey: string; // "fromTeam->toTeam"
  fromTeam: string;
  toTeam: string;
  sessionId: string;

  // Session data (from SessionManager - persistent)
  messageCount: number;
  createdAt: number;
  lastUsedAt: number;
  sessionStatus: string;

  // Process data (from ProcessPool - runtime)
  processState: string;
  pid?: number;
  messagesProcessed: number;
  uptime: number;
  queueLength: number;
  lastResponseAt: number | null;
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'idle':
      return 'bg-status-idle';
    case 'processing':
      return 'bg-status-processing';
    case 'spawning':
    case 'terminating':
      return 'bg-status-processing';
    case 'stopped':
      return 'bg-status-offline';
    default:
      return 'bg-status-offline';
  }
}

function getStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function ProcessMonitor() {
  const queryClient = useQueryClient();
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [cacheData, setCacheData] = useState<{ [sessionId: string]: string[] }>({});
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);
  const [terminalStatus, setTerminalStatus] = useState<{ [sessionId: string]: 'idle' | 'launching' | 'success' | 'copied' }>({});
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<{ [poolKey: string]: 'idle' | 'sleeping' | 'clearing' | 'deleting' | 'success' | 'error' }>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Handle WebSocket updates
  const handleProcessStatus = useCallback((_data: ProcessStatus) => {
    // Invalidate sessions query to trigger re-fetch
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
  }, [queryClient]);

  const handleCacheStream = useCallback((data: CacheStreamData) => {
    setCacheData((prev) => ({
      ...prev,
      [data.sessionId]: [
        ...(prev[data.sessionId] || []),
        `[${data.type}] ${JSON.stringify(data.content)}`,
      ],
    }));
  }, []);

  const { connected } = useWebSocket(handleProcessStatus, handleCacheStream);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch config to check if terminal script is available
  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn: async () => {
      const response = await api.getConfig();
      return response.data;
    },
    staleTime: 60000, // Config doesn't change often, cache for 1 minute
  });

  const terminalScriptAvailable = !!configData?.config?.dashboard?.forkScriptPath;

  // Fetch sessions
  const { data, isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const response = await api.getSessions();
      return response.data;
    },
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const allSessions: SessionProcessInfo[] = data?.sessions || [];
  const sessions = allSessions.filter(s => s.processState !== 'stopped');
  const poolStatus = data?.poolStatus || {};

  const handleViewCache = async (sessionId: string, fromTeam: string, toTeam: string) => {
    setSelectedSession(sessionId);
    setCacheData((prev) => ({ ...prev, [sessionId]: ['Loading cache data...'] }));

    try {
      // Use the report endpoint to get cache data
      const response = await api.getSessionCache(fromTeam, toTeam);

      if (response.data) {
        const report = response.data;
        const cacheLines: string[] = [];

        // Format cache entries for display
        if (report.entries && report.entries.length > 0) {
          for (const entry of report.entries) {
            cacheLines.push(`\n=== ${entry.type.toUpperCase()} | ${entry.status} ===`);
            cacheLines.push(`Tell String: ${entry.tellString}`);
            cacheLines.push(`Messages: ${entry.messageCount}`);
            cacheLines.push(`Created: ${new Date(entry.createdAt).toLocaleString()}`);
            if (entry.completedAt) {
              cacheLines.push(`Completed: ${new Date(entry.completedAt).toLocaleString()}`);
            }
            cacheLines.push('');

            // Show messages
            for (const msg of entry.messages) {
              const timestamp = new Date(msg.timestamp).toLocaleTimeString();
              cacheLines.push(`[${timestamp}] ${msg.type}`);
              if (msg.content) {
                cacheLines.push(msg.content);
                cacheLines.push('');
              }
            }
          }
        } else {
          cacheLines.push('No cache entries found for this session.');
        }

        setCacheData((prev) => ({ ...prev, [sessionId]: cacheLines }));
      }
    } catch (error) {
      console.error('Failed to load cache:', error);
      setCacheData((prev) => ({
        ...prev,
        [sessionId]: [`Error loading cache: ${error instanceof Error ? error.message : String(error)}`],
      }));
    }
  };

  const handleCopySessionId = useCallback((sessionId: string) => {
    navigator.clipboard.writeText(sessionId).then(() => {
      setCopiedSessionId(sessionId);
      setTimeout(() => setCopiedSessionId(null), 2000);
    });
  }, []);

  const handleLaunchTerminal = useCallback(async (sessionId: string, toTeam: string) => {
    setTerminalStatus((prev) => ({ ...prev, [sessionId]: 'launching' }));

    try {
      const response = await api.launchTerminal(sessionId, toTeam);

      if (response.data.success) {
        // Success - terminal launched
        setTerminalStatus((prev) => ({ ...prev, [sessionId]: 'success' }));
        setTimeout(() => {
          setTerminalStatus((prev) => ({ ...prev, [sessionId]: 'idle' }));
        }, 3000);
      }
    } catch (error: any) {
      const status = error.response?.status;
      const errorMsg = error.response?.data?.error || error.message;

      // Handle 404 - terminal script not found
      if (status === 404) {
        alert(
          '⚠️ Terminal Script Not Found\n\n' +
          errorMsg + '\n\n' +
          'The terminal script should be located at:\n' +
          '  ~/.iris/terminal.sh (macOS/Linux)\n' +
          '  ~/.iris/terminal.bat or terminal.ps1 (Windows)\n\n' +
          'The script receives two arguments:\n' +
          '  1. sessionId\n' +
          '  2. teamPath'
        );
        setTerminalStatus((prev) => ({ ...prev, [sessionId]: 'idle' }));
        return;
      }

      // Handle other errors
      console.error('Failed to launch terminal:', error);
      alert(
        `Failed to launch terminal: ${errorMsg}\n\n` +
        `Session ID: ${sessionId}\n` +
        `Team: ${toTeam}\n\n` +
        'You can manually run:\n' +
        `claude --resume ${sessionId}`
      );
      setTerminalStatus((prev) => ({ ...prev, [sessionId]: 'idle' }));
    }
  }, []);

  const handleSleep = useCallback(async (fromTeam: string, toTeam: string, poolKey: string) => {
    setActionStatus((prev) => ({ ...prev, [poolKey]: 'sleeping' }));
    setOpenDropdown(null);

    try {
      await api.sleepSession(fromTeam, toTeam);
      setActionStatus((prev) => ({ ...prev, [poolKey]: 'success' }));
      queryClient.invalidateQueries({ queryKey: ['sessions'] });

      setTimeout(() => {
        setActionStatus((prev) => ({ ...prev, [poolKey]: 'idle' }));
      }, 2000);
    } catch (error: any) {
      console.error('Failed to sleep session:', error);
      setActionStatus((prev) => ({ ...prev, [poolKey]: 'error' }));
      alert(`Failed to sleep session: ${error.response?.data?.error || error.message}`);

      setTimeout(() => {
        setActionStatus((prev) => ({ ...prev, [poolKey]: 'idle' }));
      }, 2000);
    }
  }, [queryClient]);

  const handleClear = useCallback(async (fromTeam: string, toTeam: string, poolKey: string) => {
    if (!confirm(`Clear session ${poolKey}? This will terminate the process, delete the old session, and create a fresh new one.`)) {
      return;
    }

    setActionStatus((prev) => ({ ...prev, [poolKey]: 'clearing' }));
    setOpenDropdown(null);

    try {
      await api.clearSession(fromTeam, toTeam);
      setActionStatus((prev) => ({ ...prev, [poolKey]: 'success' }));
      queryClient.invalidateQueries({ queryKey: ['sessions'] });

      setTimeout(() => {
        setActionStatus((prev) => ({ ...prev, [poolKey]: 'idle' }));
      }, 2000);
    } catch (error: any) {
      console.error('Failed to clear session:', error);
      setActionStatus((prev) => ({ ...prev, [poolKey]: 'error' }));
      alert(`Failed to clear session: ${error.response?.data?.error || error.message}`);

      setTimeout(() => {
        setActionStatus((prev) => ({ ...prev, [poolKey]: 'idle' }));
      }, 2000);
    }
  }, [queryClient]);

  const handleDelete = useCallback(async (fromTeam: string, toTeam: string, poolKey: string) => {
    if (!confirm(`Delete session ${poolKey}? This will permanently remove the session data. This cannot be undone.`)) {
      return;
    }

    setActionStatus((prev) => ({ ...prev, [poolKey]: 'deleting' }));
    setOpenDropdown(null);

    try {
      await api.deleteSession(fromTeam, toTeam);
      setActionStatus((prev) => ({ ...prev, [poolKey]: 'success' }));
      queryClient.invalidateQueries({ queryKey: ['sessions'] });

      setTimeout(() => {
        setActionStatus((prev) => ({ ...prev, [poolKey]: 'idle' }));
      }, 2000);
    } catch (error: any) {
      console.error('Failed to delete session:', error);
      setActionStatus((prev) => ({ ...prev, [poolKey]: 'error' }));
      alert(`Failed to delete session: ${error.response?.data?.error || error.message}`);

      setTimeout(() => {
        setActionStatus((prev) => ({ ...prev, [poolKey]: 'idle' }));
      }, 2000);
    }
  }, [queryClient]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-accent-purple" size={48} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-700 bg-bg-card p-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Session Monitor</h1>
            <p className="text-text-secondary mt-2">
              Real-time status of all team sessions (fromTeam→toTeam)
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm text-text-secondary">Active Processes</p>
              <p className="text-2xl font-bold text-accent-purple">
                {poolStatus.activeProcesses || 0} / {poolStatus.maxProcesses || 0}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-text-secondary">Status</p>
              <div className="flex items-center gap-2 mt-1">
                <div className={`w-2 h-2 rounded-full ${connected ? 'bg-status-idle' : 'bg-status-offline'}`} />
                <span className="text-sm">{connected ? 'Connected' : 'Disconnected'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Session Grid */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {sessions.map((session) => (
            <div key={session.poolKey} className="card card-hover">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">{session.poolKey}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      onClick={() => handleCopySessionId(session.sessionId)}
                      className="text-xs text-text-secondary font-mono hover:text-accent-purple transition-colors cursor-pointer flex items-center gap-1"
                      title="Click to copy full session ID"
                    >
                      {session.sessionId.slice(0, 8)}...
                      {copiedSessionId === session.sessionId ? (
                        <Check size={12} className="text-status-idle" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  </div>
                  {session.pid && (
                    <p className="text-sm text-text-secondary">PID: {session.pid}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${getStatusColor(session.processState)}`} />
                  <span className="text-sm font-medium">{getStatusLabel(session.processState)}</span>
                  <div className="relative" ref={openDropdown === session.poolKey ? dropdownRef : null}>
                    <button
                      onClick={() => setOpenDropdown(openDropdown === session.poolKey ? null : session.poolKey)}
                      className="btn-secondary px-2 py-1 flex items-center justify-center ml-2"
                      title="More actions"
                    >
                      <MoreVertical size={16} />
                    </button>

                    {openDropdown === session.poolKey && (
                      <div className="absolute right-0 mt-2 w-48 bg-bg-card border border-gray-700 rounded-lg shadow-lg z-10">
                        <button
                          onClick={() => handleSleep(session.fromTeam, session.toTeam, session.poolKey)}
                          disabled={actionStatus[session.poolKey] !== 'idle' && actionStatus[session.poolKey] !== undefined}
                          className="w-full px-4 py-2 text-left hover:bg-gray-700 flex items-center gap-2 rounded-t-lg"
                        >
                          <Moon size={16} />
                          <span>Sleep</span>
                        </button>
                        <button
                          onClick={() => handleClear(session.fromTeam, session.toTeam, session.poolKey)}
                          disabled={actionStatus[session.poolKey] !== 'idle' && actionStatus[session.poolKey] !== undefined}
                          className="w-full px-4 py-2 text-left hover:bg-gray-700 flex items-center gap-2"
                        >
                          <RotateCcw size={16} />
                          <span>Reboot</span>
                        </button>
                        <button
                          onClick={() => handleDelete(session.fromTeam, session.toTeam, session.poolKey)}
                          disabled={actionStatus[session.poolKey] !== 'idle' && actionStatus[session.poolKey] !== undefined}
                          className="w-full px-4 py-2 text-left hover:bg-gray-700 flex items-center gap-2 text-red-400 hover:text-red-300 rounded-b-lg"
                        >
                          <Trash2 size={16} />
                          <span>Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-secondary">Messages (total):</span>
                  <span className="font-medium">{session.messageCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">Messages (process):</span>
                  <span className="font-medium">{session.messagesProcessed}</span>
                </div>
                {session.uptime > 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Uptime:</span>
                    <span className="font-medium">{formatUptime(session.uptime)}</span>
                  </div>
                )}
                {session.queueLength > 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Queue:</span>
                    <span className="font-medium">{session.queueLength}</span>
                  </div>
                )}
              </div>

              {session.processState !== 'stopped' && (
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => handleViewCache(session.sessionId, session.fromTeam, session.toTeam)}
                    className="btn-secondary flex-1 flex items-center justify-center gap-2"
                  >
                    <Eye size={16} />
                    Messages
                  </button>
                  {terminalScriptAvailable && (
                    <button
                      onClick={() => handleLaunchTerminal(session.sessionId, session.toTeam)}
                      disabled={terminalStatus[session.sessionId] === 'launching'}
                      className="btn-primary flex-1 flex items-center justify-center gap-2"
                      title="Fork session in new terminal"
                    >
                      {terminalStatus[session.sessionId] === 'launching' ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Launching...
                        </>
                      ) : terminalStatus[session.sessionId] === 'success' ? (
                        <>
                          <Check size={16} />
                          Launched!
                        </>
                      ) : terminalStatus[session.sessionId] === 'copied' ? (
                        <>
                          <Copy size={16} />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Terminal size={16} />
                          Fork
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {sessions.length === 0 && (
          <div className="card text-center py-12">
            <Activity className="mx-auto mb-4 text-text-secondary" size={48} />
            <h3 className="text-xl font-bold mb-2">No Active Sessions</h3>
            <p className="text-text-secondary">
              Sessions will appear here when teams communicate
            </p>
          </div>
        )}
      </div>

      {/* Cache Viewer Modal */}
      {selectedSession && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-bg-card rounded-lg border border-gray-700 w-full max-w-4xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h2 className="text-xl font-bold">Session Messages</h2>
              <button
                onClick={() => setSelectedSession(null)}
                className="text-text-secondary hover:text-text-primary"
              >
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <div className="font-mono text-sm bg-bg-dark rounded-lg p-4 space-y-1">
                {cacheData[selectedSession]?.length > 0 ? (
                  cacheData[selectedSession].map((line, i) => (
                    <div key={i} className="text-text-secondary">
                      {line}
                    </div>
                  ))
                ) : (
                  <div className="text-text-secondary text-center py-8">
                    Waiting for cache data...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
