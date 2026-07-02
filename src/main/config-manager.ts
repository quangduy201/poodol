import { app } from "electron";
import fs from "fs";
import path from "path";

import { WINDOW } from "../shared/constants";

/**
 * Configuration Management
 * Persists application state (auth) to a single config file
 */

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
}

interface AppConfig {
  loggedIn: boolean;
  windowState: WindowState;
}

function getConfigFilePath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

function getDefaultConfig(): AppConfig {
  return {
    loggedIn: false,
    windowState: {
      width: WINDOW.DEFAULT_WIDTH,
      height: WINDOW.DEFAULT_HEIGHT,
      isMaximized: false,
    },
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
      windowState: {
        width: Number.isFinite(parsed.windowState?.width)
          ? parsed.windowState!.width
          : WINDOW.DEFAULT_WIDTH,
        height: Number.isFinite(parsed.windowState?.height)
          ? parsed.windowState!.height
          : WINDOW.DEFAULT_HEIGHT,
        x: Number.isFinite(parsed.windowState?.x)
          ? parsed.windowState!.x
          : undefined,
        y: Number.isFinite(parsed.windowState?.y)
          ? parsed.windowState!.y
          : undefined,
        isMaximized: parsed.windowState?.isMaximized === true,
      },
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

export function getWindowState(): WindowState {
  return loadConfig().windowState;
}

export function saveWindowState(windowState: WindowState): void {
  const config = loadConfig();
  config.windowState = windowState;
  saveConfig(config);
}
