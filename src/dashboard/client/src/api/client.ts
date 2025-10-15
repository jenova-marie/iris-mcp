/**
 * API client for Iris MCP Dashboard
 * Session-based API (fromTeam->toTeam)
 */

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for logging
apiClient.interceptors.request.use(
  (config) => {
    console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('[API Error]', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// API endpoints
export const api = {
  // Config
  getConfig: () => apiClient.get('/config'),
  saveConfig: (config: any) => apiClient.put('/config', config),

  // Sessions (fromTeam->toTeam pairs)
  getSessions: () => apiClient.get('/processes'),
  getSessionMetrics: (fromTeam: string, toTeam: string) =>
    apiClient.get(`/processes/${fromTeam}/${toTeam}`),
  getSessionCache: (fromTeam: string, toTeam: string) =>
    apiClient.get(`/processes/report/${fromTeam}/${toTeam}`),

  // Terminal
  launchTerminal: (sessionId: string, toTeam: string) =>
    apiClient.post('/processes/terminal/launch', { sessionId, toTeam }),

  // Health
  getHealth: () => apiClient.get('/health'),
};
