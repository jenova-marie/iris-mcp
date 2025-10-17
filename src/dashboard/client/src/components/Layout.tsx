/**
 * Main layout component with sidebar navigation
 */

import { Link, Outlet, useLocation } from 'react-router-dom';
import { Settings, Activity, FileText } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';

export function Layout() {
  const location = useLocation();
  const { connected } = useWebSocket();

  const navItems = [
    { path: '/', label: 'Processes', icon: Activity },
    { path: '/config', label: 'Configuration', icon: Settings },
    { path: '/logs', label: 'Logs', icon: FileText },
  ];

  return (
    <div className="flex h-screen bg-bg-dark">
      {/* Sidebar */}
      <aside className="w-64 bg-bg-card border-r border-gray-700 flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-700">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-accent-pink via-accent-purple to-accent-blue bg-clip-text text-transparent">
            Iris MCP
          </h1>
          <p className="text-sm text-text-secondary mt-1">Dashboard</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-lg transition-colors
                  ${isActive
                    ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                  }
                `}
              >
                <Icon size={20} />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Status indicator */}
        <div className="p-4 border-t border-gray-700">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-status-idle' : 'bg-status-offline'}`} />
            <span className="text-sm text-text-secondary">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
