/**
 * Process Monitor Page
 * Displays all team processes with status and cache viewing
 */

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Loader2, Eye, X } from 'lucide-react';
import { api } from '../api/client';
import { useWebSocket, type ProcessStatus, type CacheStreamData } from '../hooks/useWebSocket';

interface ProcessInfo {
  teamName: string;
  pid?: number;
  status: string;
  messagesProcessed: number;
  uptime: number;
  lastActivity: number;
  queueLength: number;
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
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [cacheData, setCacheData] = useState<{ [key: string]: string[] }>({});

  // Handle WebSocket updates
  const handleProcessStatus = useCallback((_data: ProcessStatus) => {
    // Invalidate processes query to trigger re-fetch
    queryClient.invalidateQueries({ queryKey: ['processes'] });
  }, [queryClient]);

  const handleCacheStream = useCallback((data: CacheStreamData) => {
    setCacheData((prev) => ({
      ...prev,
      [data.teamName]: [...(prev[data.teamName] || []), `[${data.type}] ${data.line}`],
    }));
  }, []);

  const { connected, streamCache } = useWebSocket(handleProcessStatus, handleCacheStream);

  // Fetch processes
  const { data, isLoading } = useQuery({
    queryKey: ['processes'],
    queryFn: async () => {
      const response = await api.getProcesses();
      return response.data;
    },
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const processes: ProcessInfo[] = data?.processes || [];
  const poolStatus = data?.poolStatus || {};

  const handleViewCache = (teamName: string) => {
    setSelectedTeam(teamName);
    setCacheData((prev) => ({ ...prev, [teamName]: [] }));
    streamCache(teamName);
  };

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
            <h1 className="text-3xl font-bold">Process Monitor</h1>
            <p className="text-text-secondary mt-2">
              Real-time status of all team processes
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

      {/* Process Grid */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {processes.map((process) => (
            <div key={process.teamName} className="card card-hover">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">{process.teamName}</h3>
                  {process.pid && (
                    <p className="text-sm text-text-secondary">PID: {process.pid}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${getStatusColor(process.status)}`} />
                  <span className="text-sm font-medium">{getStatusLabel(process.status)}</span>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-secondary">Messages:</span>
                  <span className="font-medium">{process.messagesProcessed}</span>
                </div>
                {process.uptime > 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Uptime:</span>
                    <span className="font-medium">{formatUptime(process.uptime)}</span>
                  </div>
                )}
                {process.queueLength > 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Queue:</span>
                    <span className="font-medium">{process.queueLength}</span>
                  </div>
                )}
              </div>

              {process.status !== 'stopped' && (
                <button
                  onClick={() => handleViewCache(process.teamName)}
                  className="btn-secondary w-full mt-4 flex items-center justify-center gap-2"
                >
                  <Eye size={16} />
                  View Cache
                </button>
              )}
            </div>
          ))}
        </div>

        {processes.length === 0 && (
          <div className="card text-center py-12">
            <Activity className="mx-auto mb-4 text-text-secondary" size={48} />
            <h3 className="text-xl font-bold mb-2">No Processes Running</h3>
            <p className="text-text-secondary">
              Processes will appear here when teams are active
            </p>
          </div>
        )}
      </div>

      {/* Cache Viewer Modal */}
      {selectedTeam && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-bg-card rounded-lg border border-gray-700 w-full max-w-4xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h2 className="text-xl font-bold">Process Cache: {selectedTeam}</h2>
              <button
                onClick={() => setSelectedTeam(null)}
                className="text-text-secondary hover:text-text-primary"
              >
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <div className="font-mono text-sm bg-bg-dark rounded-lg p-4 space-y-1">
                {cacheData[selectedTeam]?.length > 0 ? (
                  cacheData[selectedTeam].map((line, i) => (
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
