import { app } from "electron";
import fs from "fs";
import path from "path";

/**
 * Configuration Management
 * Persists application state (auth) to a single config file
 */

interface AppConfig {
  loggedIn: boolean;
}

function getConfigFilePath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

function getDefaultConfig(): AppConfig {
  return {
    loggedIn: false,
  };
}

export function loadConfig(): AppConfig {
  const filePath = getConfigFilePath();
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as Partial<AppConfig>;

    // Validate and sanitize window state
    return {
      loggedIn: parsed.loggedIn === true,
    };
  } catch {
    return getDefaultConfig();
  }
}

export function saveConfig(config: AppConfig): void {
  const filePath = getConfigFilePath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // ignore persistence errors
  }
}

export function getLoggedInState(): boolean {
  return loadConfig().loggedIn;
}

export function saveLoggedInState(loggedIn: boolean): void {
  const config = loadConfig();
  config.loggedIn = loggedIn;
  saveConfig(config);
}
