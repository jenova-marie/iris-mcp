/**
 * Unit tests for teams configuration manager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TeamsConfigManager } from '../../../src/config/teams-config.js';
import { ConfigurationError } from '../../../src/utils/errors.js';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';

describe('TeamsConfigManager', () => {
  const testConfigPath = './test-teams-config.json';
  const testDirPath = './test-project-dir';

  beforeEach(() => {
    // Create test project directory
    if (!existsSync(testDirPath)) {
      mkdirSync(testDirPath, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test config file
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
  });

  const createValidConfig = () => ({
    settings: {
      idleTimeout: 300000,
      maxProcesses: 10,
      healthCheckInterval: 30000,
    },
    teams: {
      frontend: {
        path: testDirPath,
        description: 'Frontend team',
        skipPermissions: true,
        color: '#61dafb',
      },
      backend: {
        path: testDirPath,
        description: 'Backend team',
      },
    },
  });

  describe('load', () => {
    it('should load valid configuration', () => {
      const config = createValidConfig();
      writeFileSync(testConfigPath, JSON.stringify(config, null, 2));

      const manager = new TeamsConfigManager(testConfigPath);
      const loaded = manager.load();

      expect(loaded.settings.maxProcesses).toBe(10);
      expect(loaded.teams.frontend.path).toBe(testDirPath);
    });

    it('should throw error when config file does not exist', () => {
      const manager = new TeamsConfigManager('./non-existent.json');

      expect(() => manager.load()).toThrow(ConfigurationError);
      expect(() => manager.load()).toThrow(/not found/);
    });

    it('should throw error for invalid JSON', () => {
      writeFileSync(testConfigPath, '{ invalid json }');

      const manager = new TeamsConfigManager(testConfigPath);

      expect(() => manager.load()).toThrow(ConfigurationError);
      expect(() => manager.load()).toThrow(/Invalid JSON/);
    });

    it('should throw error for invalid schema', () => {
      const invalidConfig = {
        settings: {
          idleTimeout: -1000, // Invalid: must be positive
          maxProcesses: 10,
          healthCheckInterval: 30000,
        },
        teams: {},
      };

      writeFileSync(testConfigPath, JSON.stringify(invalidConfig));

      const manager = new TeamsConfigManager(testConfigPath);

      expect(() => manager.load()).toThrow(ConfigurationError);
      expect(() => manager.load()).toThrow(/validation failed/);
    });

    it('should validate maxProcesses range', () => {
      const config = createValidConfig();
      config.settings.maxProcesses = 100; // Invalid: max is 50

      writeFileSync(testConfigPath, JSON.stringify(config));

      const manager = new TeamsConfigManager(testConfigPath);

      expect(() => manager.load()).toThrow(ConfigurationError);
    });

    it('should validate color format', () => {
      const config = createValidConfig();
      config.teams.frontend.color = 'red'; // Invalid: must be hex

      writeFileSync(testConfigPath, JSON.stringify(config));

      const manager = new TeamsConfigManager(testConfigPath);

      expect(() => manager.load()).toThrow(ConfigurationError);
    });

    it('should warn when team path does not exist', () => {
      const config = createValidConfig();
      config.teams.backend.path = '/non/existent/path';

      writeFileSync(testConfigPath, JSON.stringify(config));

      const manager = new TeamsConfigManager(testConfigPath);

      // Should load successfully but log a warning
      expect(() => manager.load()).not.toThrow();
    });
  });

  describe('getConfig', () => {
    it('should return loaded configuration', () => {
      const config = createValidConfig();
      writeFileSync(testConfigPath, JSON.stringify(config));

      const manager = new TeamsConfigManager(testConfigPath);
      manager.load();

      const retrieved = manager.getConfig();

      expect(retrieved.settings.maxProcesses).toBe(10);
    });

    it('should throw error when config not loaded', () => {
      const manager = new TeamsConfigManager(testConfigPath);

      expect(() => manager.getConfig()).toThrow(ConfigurationError);
      expect(() => manager.getConfig()).toThrow(/not loaded/);
    });
  });

  describe('getTeamConfig', () => {
    beforeEach(() => {
      const config = createValidConfig();
      writeFileSync(testConfigPath, JSON.stringify(config));
    });

    it('should return team configuration', () => {
      const manager = new TeamsConfigManager(testConfigPath);
      manager.load();

      const team = manager.getTeamConfig('frontend');

      expect(team).toBeDefined();
      expect(team?.path).toBe(testDirPath);
      expect(team?.description).toBe('Frontend team');
    });

    it('should return null for non-existent team', () => {
      const manager = new TeamsConfigManager(testConfigPath);
      manager.load();

      const team = manager.getTeamConfig('mobile');

      expect(team).toBeNull();
    });

    it('should use team-specific idleTimeout if provided', () => {
      const config = createValidConfig();
      config.teams.frontend.idleTimeout = 600000;
      writeFileSync(testConfigPath, JSON.stringify(config));

      const manager = new TeamsConfigManager(testConfigPath);
      manager.load();

      const team = manager.getTeamConfig('frontend');

      expect(team?.idleTimeout).toBe(600000);
    });

    it('should use global idleTimeout if team-specific not provided', () => {
      const manager = new TeamsConfigManager(testConfigPath);
      manager.load();

      const team = manager.getTeamConfig('backend');

      expect(team?.idleTimeout).toBe(300000);
    });
  });

  describe('getTeamNames', () => {
    it('should return list of team names', () => {
      const config = createValidConfig();
      writeFileSync(testConfigPath, JSON.stringify(config));

      const manager = new TeamsConfigManager(testConfigPath);
      manager.load();

      const teams = manager.getTeamNames();

      expect(teams).toEqual(['frontend', 'backend']);
    });

    it('should return empty array when no teams configured', () => {
      const config = createValidConfig();
      config.teams = {};
      writeFileSync(testConfigPath, JSON.stringify(config));

      const manager = new TeamsConfigManager(testConfigPath);
      manager.load();

      const teams = manager.getTeamNames();

      expect(teams).toEqual([]);
    });
  });

  describe('watch', () => {
    it('should watch configuration file for changes', (done) => {
      const config = createValidConfig();
      writeFileSync(testConfigPath, JSON.stringify(config));

      const manager = new TeamsConfigManager(testConfigPath);
      manager.load();

      let callbackInvoked = false;

      manager.watch((newConfig) => {
        if (!callbackInvoked) {
          callbackInvoked = true;
          expect(newConfig.settings.maxProcesses).toBe(20);
          done();
        }
      });

      // Modify config file
      setTimeout(() => {
        const updatedConfig = createValidConfig();
        updatedConfig.settings.maxProcesses = 20;
        writeFileSync(testConfigPath, JSON.stringify(updatedConfig));
      }, 100);
    });
  });

  describe('default config path', () => {
    it('should use teams.json in cwd by default', () => {
      const manager = new TeamsConfigManager();

      // Since teams.json exists in the project root, load should succeed
      const config = manager.load();
      expect(config).toBeDefined();
      expect(config.teams).toBeDefined();
    });
  });
});
