/**
 * API client for Iris MCP Dashboard
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

  // Processes
  getProcesses: () => apiClient.get('/processes'),
  getProcessMetrics: (teamName: string) => apiClient.get(`/processes/${teamName}`),
  getProcessCache: (teamName: string) => apiClient.get(`/processes/${teamName}/cache`),

  // Health
  getHealth: () => apiClient.get('/health'),
};
