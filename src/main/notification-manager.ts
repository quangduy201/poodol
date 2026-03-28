import { Notification, nativeImage, app } from "electron";

import { getMainWindow } from "./app-context";
import { NOTIFICATION, PLATFORM, PREFIXES } from "../shared/constants";

/**
 * Notification Management
 * Handles desktop notifications, avatar caching, and conversation tracking
 */

interface MessagePreview {
  sender?: string;
  text?: string;
  conversationId?: string;
  conversationPath?: string;
  avatarUrl?: string;
}

// Internal state - notification preview tracking
const lastNotifiedPreviewByConversation = new Map<string, string>();

// Internal state - avatar cache
const avatarIconCache = new Map<string, Electron.NativeImage | null>();

// Notification preview deduplication
function buildPreviewKey(preview: MessagePreview): string {
  if (!preview) {
    return "";
  }

  const sender = typeof preview.sender === "string" ? preview.sender : "";
  const text = typeof preview.text === "string" ? preview.text : "";
  const conversationId =
    typeof preview.conversationId === "string" ? preview.conversationId : "";

  return `${conversationId}|${sender}|${text}`;
}

function buildConversationKey(preview: MessagePreview): string {
  if (!preview) {
    return "";
  }

  const conversationPath =
    typeof preview.conversationPath === "string"
      ? preview.conversationPath.trim()
      : "";
  if (conversationPath) {
    return conversationPath;
  }

  const conversationId =
    typeof preview.conversationId === "string"
      ? preview.conversationId.trim()
      : "";
  if (conversationId) {
    return `${PREFIXES.CONVERSATION_KEY_ID}${conversationId}`;
  }

  const sender =
    typeof preview.sender === "string" ? preview.sender.trim() : "";
  return sender ? `${PREFIXES.CONVERSATION_KEY_SENDER}${sender}` : "";
}

// Avatar management
export async function getAvatarIcon(
  avatarUrl: string,
): Promise<Electron.NativeImage | null> {
  if (!avatarUrl || !nativeImage) {
    return null;
  }

  if (avatarIconCache.has(avatarUrl)) {
    return avatarIconCache.get(avatarUrl) || null;
  }

  try {
    const response = await fetch(avatarUrl);
    if (!response.ok) {
      avatarIconCache.set(avatarUrl, null);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const icon = nativeImage.createFromBuffer(buffer);
    if (!icon || icon.isEmpty()) {
      avatarIconCache.set(avatarUrl, null);
      return null;
    }

    const resizedIcon = icon.resize({
      width: NOTIFICATION.AVATAR_ICON_SIZE,
      height: NOTIFICATION.AVATAR_ICON_SIZE,
    });
    avatarIconCache.set(avatarUrl, resizedIcon);
    return resizedIcon;
  } catch {
    avatarIconCache.set(avatarUrl, null);
    return null;
  }
}

// Notification sending
export async function notifyNewMessage(preview: MessagePreview): Promise<void> {
  if (!preview || !Notification.isSupported()) {
    return;
  }

  const previewKey = buildPreviewKey(preview);
  const conversationKey = buildConversationKey(preview);
  const lastNotifiedForConversation =
    conversationKey && lastNotifiedPreviewByConversation.has(conversationKey)
      ? lastNotifiedPreviewByConversation.get(conversationKey)
      : "";

  if (previewKey && previewKey === lastNotifiedForConversation) {
    return;
  }

  if (conversationKey && previewKey) {
    lastNotifiedPreviewByConversation.set(conversationKey, previewKey);
  }

  const mainWindow = getMainWindow();
  if (mainWindow && mainWindow.isFocused()) {
    return;
  }

  const sender =
    typeof preview.sender === "string"
      ? preview.sender.trim()
      : NOTIFICATION.DEFAULT_TITLE;
  const text =
    typeof preview.text === "string"
      ? preview.text.trim()
      : NOTIFICATION.DEFAULT_BODY;

  const options: Electron.NotificationConstructorOptions = {
    title: sender,
    body: text,
  };

  const avatarUrl =
    typeof preview.avatarUrl === "string" ? preview.avatarUrl.trim() : "";
  if (avatarUrl) {
    const icon = await getAvatarIcon(avatarUrl);
    if (icon) {
      options.icon = icon;
    }
  }

  const notification = new Notification(options);
  notification.on("click", () => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();

    const conversationId =
      preview && preview.conversationId ? preview.conversationId : null;
    const conversationPath =
      preview && preview.conversationPath ? preview.conversationPath : null;

    if (conversationPath) {
      mainWindow.webContents.send("host:navigate-to-conversation", {
        conversationPath,
        conversationId,
      });
      return;
    }

    if (conversationId) {
      mainWindow.webContents.send("host:navigate-to-conversation", {
        conversationPath: `${PREFIXES.E2EE_THREAD_PATH_PREFIX}${conversationId}`,
        conversationId,
      });
    }
  });

  notification.show();
}

// Dock/taskbar badge
export function updateDockAndTaskbarBadge(count: number): void {
  app.setBadgeCount(count);

  if (PLATFORM.IS_MAC && app.dock) {
    app.dock.setBadge(count > 0 ? String(count) : "");
  }
}
