/**
 * Configuration Editor Page
 * Allows editing config.yaml with validation
 * Shows restart banner after saving
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, AlertTriangle, Loader2 } from "lucide-react";
import { api } from "../api/client";

export function ConfigEditor() {
  const queryClient = useQueryClient();
  const [showRestartBanner, setShowRestartBanner] = useState(false);
  const [configText, setConfigText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Fetch config
  const { isLoading, isError } = useQuery({
    queryKey: ["config"],
    queryFn: async () => {
      const response = await api.getConfig();
      const config = response.data.config;
      setConfigText(JSON.stringify(config, null, 2));
      return config;
    },
  });

  // Save config mutation
  const saveMutation = useMutation({
    mutationFn: async (config: any) => {
      const response = await api.saveConfig(config);
      return response.data;
    },
    onSuccess: () => {
      setShowRestartBanner(true);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["config"] });
    },
    onError: (err: any) => {
      const errorMessage = err.response?.data?.error || err.message;
      const details = err.response?.data?.details;

      if (details) {
        const formattedDetails = details
          .map((d: any) => `  - ${d.path}: ${d.message}`)
          .join("\n");
        setError(`${errorMessage}\n\n${formattedDetails}`);
      } else {
        setError(errorMessage);
      }
    },
  });

  const handleSave = () => {
    try {
      const parsed = JSON.parse(configText);
      setError(null);
      saveMutation.mutate(parsed);
    } catch (err: any) {
      setError(`Invalid JSON: ${err.message}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-accent-purple" size={48} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="card max-w-md">
          <AlertTriangle className="text-status-error mb-4" size={48} />
          <h2 className="text-xl font-bold mb-2">
            Failed to load configuration
          </h2>
          <p className="text-text-secondary">Check console for details</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-700 bg-bg-card p-6">
        <h1 className="text-3xl font-bold">Configuration</h1>
        <p className="text-text-secondary mt-2">
          Edit Iris MCP configuration (
          {process.env.IRIS_CONFIG_PATH || "$IRIS_HOME/config.yaml"})
        </p>
      </div>

      {/* Restart Banner */}
      {showRestartBanner && (
        <div className="bg-accent-purple/20 border-b border-accent-purple/30 p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle
              className="text-accent-purple flex-shrink-0"
              size={24}
            />
            <div>
              <p className="font-medium text-accent-purple">
                Configuration saved successfully
              </p>
              <p className="text-sm text-text-secondary mt-1">
                Restart Iris MCP to apply changes
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="bg-status-error/20 border-b border-status-error/30 p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle
              className="text-status-error flex-shrink-0"
              size={24}
            />
            <div className="flex-1">
              <p className="font-medium text-status-error">Validation Error</p>
              <pre className="text-sm text-text-secondary mt-2 whitespace-pre-wrap font-mono">
                {error}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-4xl">
          <div className="mb-4 flex justify-between items-center">
            <label className="block text-sm font-medium text-text-secondary">
              config.yaml
            </label>
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="btn-primary flex items-center gap-2"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  Saving...
                </>
              ) : (
                <>
                  <Save size={16} />
                  Save Configuration
                </>
              )}
            </button>
          </div>

          <textarea
            value={configText}
            onChange={(e) => {
              setConfigText(e.target.value);
              setShowRestartBanner(false);
              setError(null);
            }}
            className="w-full h-[600px] font-mono text-sm textarea"
            spellCheck={false}
          />

          <div className="mt-4 text-sm text-text-secondary space-y-2">
            <p>
              <strong>Tip:</strong> Configuration is validated before saving.
            </p>
            <p>
              <strong>Note:</strong> Changes require a server restart to take
              effect.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
