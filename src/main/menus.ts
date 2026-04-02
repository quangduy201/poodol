import {
  Menu,
  BrowserWindow,
  shell,
  MenuItemConstructorOptions,
  app,
  dialog,
  session,
} from "electron";
import fs from "fs";
import path from "path";

import { safeLoadUrl } from "./navigation";
import { ENVIRONMENT, PLATFORM, URLS } from "../shared/constants";
import {
  getUserLoggedIn,
  getMainWindow,
  onUserLoggedInChanged,
} from "./app-context";

const NEW_MESSAGE_PATH = "/messages/new";

// Listen to login state changes and update menu
onUserLoggedInChanged(() => {
  updateMenuItems();
});

function updateMenuItems(): void {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;

  const loggedIn = getUserLoggedIn();

  // Update menu items based on login state
  menu.items.forEach((menuItem) => {
    if (menuItem.submenu) {
      menuItem.submenu.items.forEach((subItem) => {
        if (
          subItem.label === "Settings..." ||
          subItem.label === "Preferences" ||
          subItem.label === "New Message" ||
          subItem.label === "Log Out" ||
          subItem.label === "Home" ||
          subItem.label === "Profile"
        ) {
          subItem.enabled = loggedIn;
        }
      });
    }
  });
}

function getFocusedWindow(): BrowserWindow | null {
  const focusedWindow = BrowserWindow.getFocusedWindow() || getMainWindow();
  if (!focusedWindow || focusedWindow.isDestroyed()) {
    return null;
  }

  return focusedWindow;
}

async function navigateFocusedWindow(url: string): Promise<void> {
  const focusedWindow = getFocusedWindow();
  if (!focusedWindow) {
    return;
  }

  try {
    await safeLoadUrl(focusedWindow, url);
  } catch (error) {
    if (ENVIRONMENT.IS_DEVELOPMENT) {
      console.error("Failed to navigate focused window to URL:", error);
    }
  }
}

function requestLogoutFocusedWindow(): void {
  const focusedWindow = getFocusedWindow();
  if (!focusedWindow) {
    return;
  }

  focusedWindow.webContents.send("host:log-out");
}

function openPreferencesFocusedWindow(): void {
  const focusedWindow = getFocusedWindow();
  if (!focusedWindow) {
    return;
  }

  focusedWindow.webContents.send("host:open-preferences");
}

function openHelpCenterFocusedWindow(): void {
  const focusedWindow = getFocusedWindow();
  if (!focusedWindow) {
    return;
  }

  focusedWindow.webContents.send("host:open-help-center");
}

async function clearBrowsingDataAndReset(): Promise<void> {
  const response = await dialog.showMessageBox({
    type: "warning",
    title: "Reset Application",
    message: "Clear all browsing data and reset the app?",
    detail:
      "This will clear all cached data and reset the application to its initial state. The app will relaunch after this action. Are you sure you want to proceed?",
    buttons: ["Cancel", "Reset"],
    defaultId: 0,
    cancelId: 0,
  });

  if (response.response !== 1) {
    return; // User cancelled
  }

  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  try {
    // Clear browsing data from session
    session.defaultSession.clearCache();
    session.defaultSession.clearStorageData();

    // Delete cache directory
    const cacheDir = path.join(app.getPath("userData"), "Cache");
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }

    // Delete config file
    const configFilePath = path.join(app.getPath("userData"), "config.json");
    if (fs.existsSync(configFilePath)) {
      fs.unlinkSync(configFilePath);
    }

    // Delete window state file
    const windowStateFilePath = path.join(
      app.getPath("userData"),
      "window-state.json",
    );
    if (fs.existsSync(windowStateFilePath)) {
      fs.unlinkSync(windowStateFilePath);
    }

    // Relaunch the app
    app.relaunch();
    app.quit();
  } catch (error) {
    if (ENVIRONMENT.IS_DEVELOPMENT) {
      console.error("Failed to reset app:", error);
    }
    dialog.showErrorBox("Error", "Failed to reset the app. Please try again.");
  }
}

function navigateFocusedWindowInPage(payload: unknown): void {
  const focusedWindow = getFocusedWindow();
  if (!focusedWindow) {
    return;
  }

  focusedWindow.webContents.send("host:navigate-to-conversation", payload);
}

function buildMenuTemplate(): MenuItemConstructorOptions[] {
  const appMenu: MenuItemConstructorOptions[] = PLATFORM.IS_MAC
    ? [
        {
          label: "Poodol",
          submenu: [
            { role: "about" },
            { type: "separator" },
            {
              label: "Settings...",
              accelerator: "Cmd+,",
              click: () => {
                openPreferencesFocusedWindow();
              },
            },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
      ]
    : [];

  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      {
        label: "New Message",
        accelerator: PLATFORM.IS_MAC ? "Cmd+N" : "Ctrl+N",
        click: () => {
          navigateFocusedWindowInPage({
            conversationPath: NEW_MESSAGE_PATH,
          });
        },
      },
      ...(!PLATFORM.IS_MAC
        ? [
            {
              label: "Preferences",
              accelerator: "Ctrl+,",
              click: () => {
                openPreferencesFocusedWindow();
              },
            },
          ]
        : []),
      {
        label: "Log Out",
        accelerator: PLATFORM.IS_MAC ? "Cmd+Shift+W" : "Ctrl+Shift+W",
        click: () => {
          requestLogoutFocusedWindow();
        },
      },
      { type: "separator" },
      { role: PLATFORM.IS_MAC ? "close" : "quit" },
    ],
  };

  const editMenu: MenuItemConstructorOptions = { role: "editMenu" };

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      { role: "reload" },
      { type: "separator" as const },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" as const },
      { role: "togglefullscreen" },
      ...(ENVIRONMENT.IS_DEVELOPMENT
        ? [{ type: "separator" as const }, { role: "toggleDevTools" as const }]
        : []),
    ],
  };

  const goMenu: MenuItemConstructorOptions = {
    label: "Go",
    submenu: [
      {
        label: "Home",
        accelerator: PLATFORM.IS_MAC ? "Cmd+Shift+H" : "Ctrl+Shift+H",
        click: async () => {
          await navigateFocusedWindow(URLS.MESSAGES_INBOX_URL);
        },
      },
      {
        label: "Profile",
        accelerator: PLATFORM.IS_MAC ? "Cmd+Shift+P" : "Ctrl+Shift+P",
        click: async () => {
          await navigateFocusedWindow(URLS.PROFILE_URL);
        },
      },
      { type: "separator" },
      {
        label: "Back",
        accelerator: PLATFORM.IS_MAC ? "Cmd+[" : "Alt+Left",
        click: async () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (
            focusedWindow &&
            focusedWindow.webContents.navigationHistory.canGoBack()
          ) {
            focusedWindow.webContents.navigationHistory.goBack();
          }
        },
      },
      {
        label: "Forward",
        accelerator: PLATFORM.IS_MAC ? "Cmd+]" : "Alt+Right",
        click: async () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (
            focusedWindow &&
            focusedWindow.webContents.navigationHistory.canGoForward()
          ) {
            focusedWindow.webContents.navigationHistory.goForward();
          }
        },
      },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = { role: "windowMenu" };

  const helpMenu: MenuItemConstructorOptions = {
    role: "help",
    submenu: [
      {
        label: "Messenger Help Center",
        accelerator: "F1",
        click: () => {
          openHelpCenterFocusedWindow();
        },
      },
      {
        label: "Open Messenger in Browser",
        click: async () => {
          await shell.openExternal(URLS.MESSAGES_INBOX_URL);
        },
      },
      { type: "separator" },
      {
        label: "GitHub Repository",
        click: async () => {
          await shell.openExternal(URLS.GITHUB_URL);
        },
      },
      {
        label: "Report an Issue",
        click: async () => {
          await shell.openExternal(URLS.REPORT_ISSUE_URL);
        },
      },
      { type: "separator" },
      {
        label: "Clear Browsing Data and Reset App",
        click: async () => {
          await clearBrowsingDataAndReset();
        },
      },
    ],
  };

  return [
    ...appMenu,
    fileMenu,
    editMenu,
    viewMenu,
    goMenu,
    windowMenu,
    helpMenu,
  ];
}

export function setupMenus(): void {
  const menu = Menu.buildFromTemplate(buildMenuTemplate());
  Menu.setApplicationMenu(menu);
  updateMenuItems(); // Update menu items based on current login state
}
