/**
 * Permission Approval Modal
 * Simple popup that displays permission requests and auto-dismisses after 60s
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import type { PendingPermissionRequest } from '../hooks/useWebSocket';

interface PermissionApprovalModalProps {
  request: PendingPermissionRequest | null;
  onApprove: (permissionId: string) => void;
  onDeny: (permissionId: string) => void;
  onTimeout: () => void;
}

export function PermissionApprovalModal({
  request,
  onApprove,
  onDeny,
  onTimeout,
}: PermissionApprovalModalProps) {
  const [timeRemaining, setTimeRemaining] = useState(60);

  useEffect(() => {
    if (!request) {
      setTimeRemaining(60);
      return;
    }

    // Countdown timer
    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [request, onTimeout]);

  if (!request) {
    return null;
  }

  const handleApprove = () => {
    onApprove(request.permissionId);
  };

  const handleDeny = () => {
    onDeny(request.permissionId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-yellow-500 to-orange-500 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-white" />
            <h2 className="text-xl font-semibold text-white">Permission Request</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-white bg-opacity-20 rounded-full px-3 py-1 text-white text-sm font-medium">
              {timeRemaining}s
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          <div className="space-y-4">
            {/* Team Info */}
            <div>
              <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Team</label>
              <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
                {request.teamName}
              </div>
            </div>

            {/* Tool Info */}
            <div>
              <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Tool</label>
              <div className="mt-1 font-mono text-sm bg-gray-100 dark:bg-gray-900 px-3 py-2 rounded">
                {request.toolName}
              </div>
            </div>

            {/* Reason */}
            {request.reason && (
              <div>
                <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Reason</label>
                <div className="mt-1 text-gray-900 dark:text-white">
                  {request.reason}
                </div>
              </div>
            )}

            {/* Tool Input */}
            <div>
              <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Input Parameters</label>
              <div className="mt-1 bg-gray-100 dark:bg-gray-900 rounded p-3 max-h-64 overflow-y-auto">
                <pre className="text-xs font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                  {JSON.stringify(request.toolInput, null, 2)}
                </pre>
              </div>
            </div>

            {/* Session ID */}
            <div>
              <label className="text-sm font-medium text-gray-500 dark:text-gray-400">Session ID</label>
              <div className="mt-1 font-mono text-xs text-gray-600 dark:text-gray-400">
                {request.sessionId}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 dark:bg-gray-900 px-6 py-4 flex items-center justify-end gap-3">
          <button
            onClick={handleDeny}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
          >
            <XCircle className="w-4 h-4" />
            Deny
          </button>
          <button
            onClick={handleApprove}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
          >
            <CheckCircle className="w-4 h-4" />
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
