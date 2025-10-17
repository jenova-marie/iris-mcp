/**
 * Main App component with routing
 */

import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { ProcessMonitor } from './pages/ProcessMonitor';
import { ConfigEditor } from './pages/ConfigEditor';
import { LogViewer } from './pages/LogViewer';
import { PermissionApprovalModal } from './components/PermissionApprovalModal';
import { useWebSocket, type PendingPermissionRequest } from './hooks/useWebSocket';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function App() {
  const [currentPermission, setCurrentPermission] = useState<PendingPermissionRequest | null>(null);

  // WebSocket connection with permission handling
  const { respondToPermission } = useWebSocket(
    undefined, // onProcessStatus
    undefined, // onCacheStream
    (request) => {
      // onPermissionRequest - show modal
      setCurrentPermission(request);
    },
  );

  const handleApprove = (permissionId: string) => {
    respondToPermission(permissionId, true, 'Approved by user via dashboard');
    setCurrentPermission(null);
  };

  const handleDeny = (permissionId: string) => {
    respondToPermission(permissionId, false, 'Denied by user via dashboard');
    setCurrentPermission(null);
  };

  const handleTimeout = () => {
    // Just close the modal, backend will handle timeout
    setCurrentPermission(null);
  };

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<ProcessMonitor />} />
            <Route path="config" element={<ConfigEditor />} />
            <Route path="logs" element={<LogViewer />} />
          </Route>
        </Routes>
      </BrowserRouter>

      {/* Global permission approval modal */}
      <PermissionApprovalModal
        request={currentPermission}
        onApprove={handleApprove}
        onDeny={handleDeny}
        onTimeout={handleTimeout}
      />
    </QueryClientProvider>
  );
}

export default App;
