import { shell, BrowserWindow } from "electron";
import path from "path";

import {
  ALLOWED_IN_APP_HOSTS,
  ALLOWED_MAIN_WINDOW_PATH_PREFIXES,
  PLATFORM,
  TRUSTED_PERMISSION_HOST_SUFFIXES,
  URLS,
} from "../shared/constants";
import { parseHttpUrl } from "../shared/utils";

function isAllowedInAppUrl(urlString: string): boolean {
  const parsedUrl = parseHttpUrl(urlString);
  if (!parsedUrl) {
    return false;
  }

  return ALLOWED_IN_APP_HOSTS.some((host) => parsedUrl.hostname === host);
}

function isAllowedInMainWindow(urlString: string): boolean {
  const parsedUrl = parseHttpUrl(urlString);
  if (!parsedUrl) {
    return false;
  }

  if (parsedUrl.hostname !== "www.facebook.com") {
    return false;
  }

  const pathname = parsedUrl.pathname;

  // Allow root path
  if (pathname === "/" || pathname === "") {
    return true;
  }

  // Allow endpoints with specific path prefixes
  return ALLOWED_MAIN_WINDOW_PATH_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
}

function isTrustedPermissionOrigin(origin: string): boolean {
  const parsedOrigin = parseHttpUrl(origin);
  if (!parsedOrigin) {
    return false;
  }

  return TRUSTED_PERMISSION_HOST_SUFFIXES.some((suffix) =>
    parsedOrigin.hostname.endsWith(suffix),
  );
}

export function openInDefaultBrowserIfSupported(urlString: string): void {
  const parsedUrl = parseHttpUrl(urlString);
  if (!parsedUrl) {
    return;
  }

  shell.openExternal(parsedUrl.toString());
}

export function openNewWindow(url: string): void {
  const newWin = new BrowserWindow({
    width: 1280,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  newWin.loadURL(url);
}

export function enforceUrlPolicy(
  browserWindow: BrowserWindow,
  isMainWindow = false,
): void {
  const webContents = browserWindow.webContents;

  webContents.on("will-navigate", (event, url) => {
    if (!isMainWindow || isAllowedInMainWindow(url)) {
      return;
    }

    event.preventDefault();
    if (isAllowedInAppUrl(url)) {
      openNewWindow(url);
    } else {
      openInDefaultBrowserIfSupported(url);
    }
  });

  webContents.on("will-redirect", (event, url) => {
    if (!isMainWindow || isAllowedInMainWindow(url)) {
      return;
    }

    event.preventDefault();
    if (isAllowedInAppUrl(url)) {
      openNewWindow(url);
    } else {
      openInDefaultBrowserIfSupported(url);
    }
  });

  webContents.setWindowOpenHandler(({ url }) => {
    if (url === URLS.ABOUT_BLANK_URL) {
      return { action: "allow" };
    }

    if (isAllowedInMainWindow(url)) {
      openNewWindow(url);
      return { action: "deny" };
    }

    if (isAllowedInAppUrl(url)) {
      openNewWindow(url);
      return { action: "deny" };
    }

    openInDefaultBrowserIfSupported(url);
    return { action: "deny" };
  });
}

interface SessionSecurityConfig {
  session: Electron.Session;
  systemPreferences: Electron.SystemPreferences;
}

export function configureSessionSecurity({
  session,
  systemPreferences,
}: SessionSecurityConfig): void {
  session.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin) => {
      if (
        permission === "notifications" ||
        permission === "media" /* camera and microphone access */
      ) {
        // Only allow these permissions for trusted origins
        const isTrusted = isTrustedPermissionOrigin(requestingOrigin);
        return isTrusted;
      }

      // Deny all other permissions by default
      return false;
    },
  );

  session.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const requestingOrigin = details.requestingUrl || webContents.getURL();
      const isTrustedOrigin = isTrustedPermissionOrigin(requestingOrigin);

      if (permission === "notifications") {
        callback(isTrustedOrigin);
        return;
      }

      if (permission === "media") {
        if (!isTrustedOrigin) {
          callback(false);
          return;
        }

        if (PLATFORM.IS_MAC) {
          const mediaTypes = ["microphone", "camera"] as const;

          for (const mediaType of mediaTypes) {
            const status = systemPreferences.getMediaAccessStatus(mediaType);
            if (status !== "granted") {
              const granted = systemPreferences.askForMediaAccess(mediaType);
              if (!granted) {
                callback(false);
                return;
              }
            }
          }
        }

        callback(true);
        return;
      }

      // Deny all other permissions by default
      callback(false);
    },
  );
}
