import { app } from "electron";
import os from "os";

const IS_PACKAGED_APP = Boolean(app && app.isPackaged);
const CURRENT_ENVIRONMENT =
  process.env.NODE_ENV === "production" || IS_PACKAGED_APP
    ? "production"
    : "development";

const CURRENT_PLATFORM = process.platform || os.platform();

export const ENVIRONMENT = {
  IS_PRODUCTION: CURRENT_ENVIRONMENT === "production",
  IS_DEVELOPMENT: CURRENT_ENVIRONMENT === "development",
};

export const PLATFORM = {
  IS_MAC: CURRENT_PLATFORM === "darwin",
  IS_WINDOWS: CURRENT_PLATFORM === "win32",
  IS_LINUX: CURRENT_PLATFORM === "linux",
};

export const WINDOW = {
  APP_NAME: "Poodol",
  DEFAULT_WIDTH: 1280,
  DEFAULT_HEIGHT: 820,
  MIN_WIDTH: 980,
  MIN_HEIGHT: 640,
  BACKGROUND_COLOR: "#ffffff",
  ICON_RELATIVE_PATH: "assets/icons/icon.png",
};

export const WEB_PREFERENCES = {
  CONTEXT_ISOLATION: true,
  NODE_INTEGRATION: false,
  SANDBOX: true,
  SPELLCHECK: true,
  BACKGROUND_THROTTLING: false,
};

export const URLS = {
  LOGIN_URL: "https://www.facebook.com/login.php",
  MESSAGES_INBOX_URL: "https://www.facebook.com/messages/e2ee/t/",
  PROFILE_URL: "https://www.facebook.com/me",
  GITHUB_URL: "https://github.com/quangduy201/poodol",
  REPORT_ISSUE_URL: "https://github.com/quangduy201/poodol/issues/new",
  MESSENGER_HELP_CENTER_URL: "https://www.facebook.com/help/messenger-app",
  ABOUT_BLANK_URL: "about:blank",
};

export const NOTIFICATION = {
  MAX_NOTIFIED_CONVERSATIONS: 500,
  DEFAULT_TITLE: "New message",
  DEFAULT_BODY: "You have a new message.",
  AVATAR_ICON_SIZE: 64,
};

export const PREFIXES = {
  CONVERSATION_KEY_ID: "id:",
  CONVERSATION_KEY_SENDER: "sender:",
  E2EE_THREAD_PATH_PREFIX: "/messages/e2ee/t/",
};

export const ALLOWED_IN_APP_HOSTS = ["facebook.com", "www.facebook.com"];
export const ALLOWED_MAIN_WINDOW_PATH_PREFIXES = [
  "/messages/e2ee/t",
  "/messages/t",
  "/login.php",
  "/logout.php",
  "/two_step_verification",
  "/checkpoint",
];
