/**
 * LogViewer Page
 * Real-time log streaming from wonder-logger memory transport
 */

import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useWebSocket, type ParsedLogEntry, type LogBatchData } from '../hooks/useWebSocket';

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

const LEVEL_COLORS: Record<string, string> = {
  trace: 'text-gray-500',
  debug: 'text-blue-400',
  info: 'text-green-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
  fatal: 'text-red-600 font-bold',
};

const LEVEL_BG_COLORS: Record<string, string> = {
  trace: 'bg-gray-500/10',
  debug: 'bg-blue-500/10',
  info: 'bg-green-500/10',
  warn: 'bg-yellow-500/10',
  error: 'bg-red-500/10',
  fatal: 'bg-red-600/20',
};

export function LogViewer() {
  const [logs, setLogs] = useState<ParsedLogEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedLevels, setSelectedLevels] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('');
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Handle log batch updates
  const handleLogBatch = (data: LogBatchData) => {
    setLogs((prev) => [...prev, ...data.logs]);
  };

  const { connected, startLogStream, stopLogStream } = useWebSocket(
    undefined, // onProcessStatus
    undefined, // onCacheStream
    undefined, // onPermissionRequest
    handleLogBatch, // onLogBatch
  );

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // Start streaming on mount if connected
  useEffect(() => {
    if (connected && !isStreaming) {
      handleStartStreaming();
    }

    // Stop streaming on unmount
    return () => {
      if (isStreaming) {
        stopLogStream();
      }
    };
  }, [connected]);

  const handleStartStreaming = () => {
    const options = selectedLevels.length > 0 ? { level: selectedLevels } : undefined;
    startLogStream(options);
    setIsStreaming(true);
  };

  const handleStopStreaming = () => {
    stopLogStream();
    setIsStreaming(false);
  };

  const handleClearLogs = () => {
    setLogs([]);
    setExpandedLogs(new Set());
  };

  const toggleLogExpanded = (logId: string) => {
    setExpandedLogs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(logId)) {
        newSet.delete(logId);
      } else {
        newSet.add(logId);
      }
      return newSet;
    });
  };

  const handleToggleLevel = (level: string) => {
    setSelectedLevels((prev) =>
      prev.includes(level)
        ? prev.filter((l) => l !== level)
        : [...prev, level]
    );
  };

  const handleApplyFilter = () => {
    if (isStreaming) {
      handleStopStreaming();
    }
    handleStartStreaming();
  };

  // Filter logs by search text
  const filteredLogs = logs.filter((log) => {
    if (!filter) return true;
    const searchText = filter.toLowerCase();
    return (
      log.message?.toLowerCase().includes(searchText) ||
      log.context?.toLowerCase().includes(searchText) ||
      JSON.stringify(log).toLowerCase().includes(searchText)
    );
  });

  // Format timestamp
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-4">
        <h1 className="text-2xl font-bold text-white mb-4">Wonder Logger Stream</h1>

        {/* Controls */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Stream Control */}
          <div className="flex gap-2">
            {!isStreaming ? (
              <button
                onClick={handleStartStreaming}
                disabled={!connected}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded font-medium transition-colors"
              >
                Start Streaming
              </button>
            ) : (
              <button
                onClick={handleStopStreaming}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-medium transition-colors"
              >
                Stop Streaming
              </button>
            )}

            <button
              onClick={handleClearLogs}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded font-medium transition-colors"
            >
              Clear Logs
            </button>
          </div>

          {/* Level Filters */}
          <div className="flex gap-2 items-center">
            <span className="text-gray-400 text-sm">Levels:</span>
            {LOG_LEVELS.map((level) => (
              <button
                key={level}
                onClick={() => handleToggleLevel(level)}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  selectedLevels.includes(level) || selectedLevels.length === 0
                    ? `${LEVEL_BG_COLORS[level]} ${LEVEL_COLORS[level]} border-2 border-current`
                    : 'bg-gray-700 text-gray-500 border-2 border-transparent'
                }`}
              >
                {level}
              </button>
            ))}
            {selectedLevels.length > 0 && (
              <button
                onClick={handleApplyFilter}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors"
              >
                Apply Filter
              </button>
            )}
          </div>

          {/* Auto-scroll Toggle */}
          <label className="flex items-center gap-2 text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm">Auto-scroll</span>
          </label>

          {/* Connection Status */}
          <div className="ml-auto flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                connected ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-sm text-gray-400">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
            {isStreaming && (
              <span className="text-sm text-green-400 animate-pulse">● Streaming</span>
            )}
          </div>
        </div>

        {/* Search Filter */}
        <div className="mt-3">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter logs by message, context, or any field..."
            className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
          />
        </div>

        {/* Stats */}
        <div className="mt-3 flex gap-4 text-sm text-gray-400">
          <span>Total: {logs.length}</span>
          <span>Filtered: {filteredLogs.length}</span>
        </div>
      </div>

      {/* Logs Container */}
      <div
        ref={logsContainerRef}
        className="flex-1 overflow-auto bg-gray-900 p-4 font-mono text-sm"
      >
        {filteredLogs.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            {logs.length === 0 ? (
              <div>
                <p className="text-lg mb-2">No logs yet</p>
                <p className="text-sm">
                  {isStreaming ? 'Waiting for log entries...' : 'Start streaming to view logs'}
                </p>
              </div>
            ) : (
              <p>No logs match the current filter</p>
            )}
          </div>
        ) : (
          <>
            {filteredLogs.map((log, index) => {
              const logId = `${log.timestamp}-${index}`;
              const isExpanded = expandedLogs.has(logId);

              return (
                <div
                  key={logId}
                  className={`mb-1 p-2 rounded ${LEVEL_BG_COLORS[log.level] || 'bg-gray-800'}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Expand/Collapse Button */}
                    <button
                      onClick={() => toggleLogExpanded(logId)}
                      className="flex-shrink-0 text-gray-400 hover:text-gray-200 transition-colors mt-0.5"
                      title={isExpanded ? 'Collapse' : 'Expand raw log'}
                    >
                      {isExpanded ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                    </button>

                    {/* Timestamp */}
                    <span className="text-gray-500 flex-shrink-0 text-xs">
                      {formatTime(log.timestamp)}
                    </span>

                    {/* Level */}
                    <span
                      className={`${LEVEL_COLORS[log.level] || 'text-gray-400'} flex-shrink-0 font-bold uppercase text-xs w-12`}
                    >
                      {log.level}
                    </span>

                    {/* Context */}
                    {log.context && (
                      <span className="text-purple-400 flex-shrink-0 text-xs">
                        [{log.context}]
                      </span>
                    )}

                    {/* Message */}
                    <span className="text-gray-200 flex-1 break-words">{log.message}</span>
                  </div>

                  {/* Expanded Raw Log */}
                  {isExpanded && (
                    <div className="mt-2 ml-5 border-l-2 border-gray-600 pl-3">
                      <div className="text-xs text-gray-400 mb-1 font-semibold">Raw Log Entry:</div>
                      <pre className="bg-gray-950 p-3 rounded text-xs overflow-x-auto text-green-400 border border-gray-700">
                        {JSON.stringify(log, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Additional Fields (only show when not expanded) */}
                  {!isExpanded && Object.keys(log).filter(
                    (key) => !['timestamp', 'level', 'context', 'message'].includes(key)
                  ).length > 0 && (
                    <div className="mt-1 ml-5 text-gray-400 text-xs">
                      {Object.entries(log)
                        .filter(([key]) => !['timestamp', 'level', 'context', 'message'].includes(key))
                        .map(([key, value]) => (
                          <div key={key} className="truncate">
                            <span className="text-gray-500">{key}:</span>{' '}
                            {typeof value === 'object'
                              ? JSON.stringify(value)
                              : String(value)}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={logsEndRef} />
          </>
        )}
      </div>
    </div>
  );
}
