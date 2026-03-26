import { BrowserWindow } from "electron";
import { EventEmitter } from "events";

/**
 * Centralized Application State Management
 * Stores application-level state and provides reactive updates via EventEmitter
 */

const stateEmitter = new EventEmitter();

// Window Reference
let mainWindow: BrowserWindow | null = null;

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

// Login State
let isUserLoggedIn = false;
let startedOnLoginPage = false;

export function setUserLoggedIn(loggedIn: boolean): void {
  if (isUserLoggedIn !== loggedIn) {
    isUserLoggedIn = loggedIn;
    stateEmitter.emit("userLoggedInChanged", loggedIn);
  }
}

export function getUserLoggedIn(): boolean {
  return isUserLoggedIn;
}

export function onUserLoggedInChanged(
  callback: (loggedIn: boolean) => void,
): void {
  stateEmitter.on("userLoggedInChanged", callback);
}

export function setStartedOnLoginPage(started: boolean): void {
  startedOnLoginPage = started;
}

export function getStartedOnLoginPage(): boolean {
  return startedOnLoginPage;
}

// URL Normalization State
let isNormalizingMainWindowUrl = false;

export function setNormalizingMainWindowUrl(normalizing: boolean): void {
  isNormalizingMainWindowUrl = normalizing;
}

export function isNormalizingUrl(): boolean {
  return isNormalizingMainWindowUrl;
}
