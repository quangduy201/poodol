import { contextBridge, ipcRenderer } from "electron";

// DOM types are available in the preload script
declare const Node: typeof globalThis.Node;
declare const Text: typeof globalThis.Text;
declare const Element: typeof globalThis.Element;
declare const KeyboardEvent: typeof globalThis.KeyboardEvent;
declare const MouseEvent: typeof globalThis.MouseEvent;
declare const MutationObserver: typeof globalThis.MutationObserver;
declare const PopStateEvent: typeof globalThis.PopStateEvent;

interface MessagePreview {
  sender: string;
  text: string;
  conversationId: string;
  conversationPath: string;
  avatarUrl: string;
}

interface NavigatePayload {
  conversationPath?: string;
  conversationId?: string;
}

const pendingNavigationPayloads: NavigatePayload[] = [];

function getRenderedText(node: Node | null): string {
  if (!node) {
    return "";
  }

  const parts: string[] = [];

  const walk = (currentNode: Node | null) => {
    if (!currentNode) {
      return;
    }

    if (currentNode.nodeType === Node.TEXT_NODE) {
      const value = ((currentNode as Text).nodeValue || "").replace(
        /\s+/g,
        " ",
      );
      if (value.trim()) {
        parts.push(value);
      }
      return;
    }

    if (currentNode.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = currentNode as Element;

    if (element.tagName === "IMG") {
      const alt = (element.getAttribute("alt") || "").trim();
      if (alt) {
        parts.push(alt);
      }
      return;
    }

    const children = Array.from(element.childNodes);
    for (const child of children) {
      walk(child);
    }
  };

  walk(node);

  return parts
    .join(" ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeReactionPreviewText(text: string): string {
  return text.replace(/\(y\)/gi, "👍").replace(/❤/g, "❤️");
}

function getConversationIdFromElement(element: Element | null): string {
  if (!element) {
    return "";
  }

  const threadLink = element.querySelector(
    'a[href*="/messages/e2ee/t/"], a[href*="/messages/t/"]',
  );
  if (!threadLink || typeof threadLink.getAttribute !== "function") {
    return "";
  }

  const href = threadLink.getAttribute("href") || "";
  const match = href.match(/\/messages\/(?:e2ee\/)?t\/([^/?#]+)/);
  return match ? match[1] : "";
}

function getConversationPathFromElement(element: Element | null): string {
  if (!element) {
    return "";
  }

  const threadLink = element.querySelector(
    'a[href*="/messages/e2ee/t/"], a[href*="/messages/t/"]',
  );
  if (!threadLink || typeof threadLink.getAttribute !== "function") {
    return "";
  }

  const href = threadLink.getAttribute("href") || "";
  const match = href.match(/(\/messages\/(?:e2ee\/)?t\/[^/?#]+)\/?/);
  return match ? match[1] : "";
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`Failed to load avatar image: ${src}`));
    image.src = src;
  });
}
async function buildCombinedAvatarDataUrl(
  imageUrls: string[],
): Promise<string> {
  if (imageUrls.length === 0) {
    return "";
  }

  if (imageUrls.length === 1) {
    return imageUrls[0];
  }

  const size = 128;
  const loadedImages: HTMLImageElement[] = [];
  for (const url of imageUrls.slice(0, 2)) {
    try {
      const image = await loadImage(url);
      loadedImages.push(image);
    } catch {
      // Ignore load failures and continue with available images
    }
  }

  if (loadedImages.length === 0) {
    return imageUrls[0];
  }

  if (loadedImages.length === 1) {
    return imageUrls[0];
  }

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return imageUrls[0];
  }
  // Transparent canvas background
  ctx.clearRect(0, 0, size, size);

  const first = loadedImages[0];
  const second = loadedImages[1];

  const avatarSize = size * 0.72;

  // Positions: second (background) at top-right, first (foreground) at bottom-left
  const firstX = 0;
  const firstY = size - avatarSize;
  const secondX = size - avatarSize;
  const secondY = 0;

  const drawAvatarCircle = (
    image: HTMLImageElement,
    x: number,
    y: number,
    diameter: number,
  ) => {
    const centerX = x + diameter / 2;
    const centerY = y + diameter / 2;
    const radius = diameter / 2;

    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(image, x, y, diameter, diameter);
    ctx.restore();
  };

  // Draw background first, then overlay first image on top
  drawAvatarCircle(second, secondX, secondY, avatarSize);
  drawAvatarCircle(first, firstX, firstY, avatarSize);

  return canvas.toDataURL("image/png");
}

async function getAvatarUrlFromElement(
  element: Element | null,
): Promise<string> {
  if (!element) {
    return "";
  }

  const avatarImages = Array.from(
    element.querySelectorAll(
      'a[href*="/messages/"] img[src], img[src*="fbcdn.net"]',
    ),
  );

  const validAvatarUrls = avatarImages
    .map((image) => ({
      src: (image.getAttribute("src") || "").trim(),
      width: Number.parseInt(image.getAttribute("width") || "0", 10),
      height: Number.parseInt(image.getAttribute("height") || "0", 10),
    }))
    .filter(
      (entry) =>
        entry.src &&
        !entry.src.includes("emoji.php") &&
        !(
          (entry.width > 0 && entry.width < 24) ||
          (entry.height > 0 && entry.height < 24)
        ),
    )
    .map((entry) => entry.src);

  if (validAvatarUrls.length >= 2) {
    return await buildCombinedAvatarDataUrl(validAvatarUrls.slice(0, 2));
  }

  return validAvatarUrls[0] || "";
}

interface UnreadSummary {
  container: Element;
  messageNode: Element;
}

function isUnreadRow(row: Element | null): boolean {
  if (!row) {
    return false;
  }

  const unreadSummary = findUnreadSummaryNode(row);
  if (unreadSummary) {
    return true;
  }

  const unreadMarker = Array.from(row.querySelectorAll("div, span")).find(
    (node) => getRenderedText(node).trim() === "Unread message:",
  );

  return Boolean(unreadMarker);
}

function findUnreadSummaryNode(row: Element | null): UnreadSummary | null {
  if (!row) {
    return null;
  }

  const candidateSpans = Array.from(row.querySelectorAll("span"));
  for (const span of candidateSpans) {
    const children = Array.from(span.children);
    if (children.length < 2) {
      continue;
    }

    const hasLeadingLabel = children.some(
      (child) =>
        child.tagName === "DIV" && getRenderedText(child).trim().length > 0,
    );
    if (!hasLeadingLabel) {
      continue;
    }

    const messageChild = children.find(
      (child) =>
        child.matches?.('span[dir="auto"]') &&
        getRenderedText(child).trim().length > 0,
    );

    if (messageChild) {
      return {
        container: span,
        messageNode: messageChild as Element,
      };
    }
  }

  return null;
}

function isMutedRow(row: Element | null): boolean {
  if (!row) {
    return false;
  }

  if (row.querySelector('svg[style*="--x-color: var(--disabled-icon)"]')) {
    return true;
  }

  if (row.querySelector('path[d^="M2.5 6c0-.322"]')) {
    return true;
  }

  return false;
}

function getThreadRows(): Element[] {
  const rows = Array.from(document.querySelectorAll('div[role="row"]'));
  return rows.filter((row) => {
    const link = row.querySelector(
      'a[href*="/messages/e2ee/t/"], a[href*="/messages/t/"]',
    );
    return Boolean(link);
  });
}

function getUnreadRows(): Element[] {
  return getThreadRows().filter((row) => isUnreadRow(row));
}

async function extractPreviewFromThreadRow(
  row: Element | null,
): Promise<MessagePreview | null> {
  if (!row) {
    return null;
  }

  const unreadSummary = findUnreadSummaryNode(row as Element);
  const unreadMarker = unreadSummary?.container;

  let messageText = "";
  if (unreadSummary?.messageNode) {
    messageText = getRenderedText(unreadSummary.messageNode).trim();
  } else if (unreadMarker) {
    const messageNode =
      unreadMarker.parentElement?.querySelector('span[dir="auto"]');
    if (messageNode) {
      messageText = getRenderedText(messageNode).trim();
    }
  }

  const senderNodes = Array.from(row.querySelectorAll('span[dir="auto"]'))
    .map((node) => getRenderedText(node).trim())
    .filter(Boolean)
    .filter((text) => text !== "Unread message:")
    .filter((text) => !text.includes(" · "))
    .filter((text) => text.length <= 120);

  const sender = senderNodes[0] || "";

  const textNodes = Array.from(
    row.querySelectorAll("span[dir='auto'], div[dir='auto']"),
  )
    .map((node) => getRenderedText(node))
    .filter(Boolean)
    .filter((text) => text.length <= 240);

  if (textNodes.length === 0) {
    if (!sender || !messageText) {
      return null;
    }
  }

  const text = normalizeReactionPreviewText(
    messageText || textNodes[1] || textNodes[0] || "",
  );

  if (!sender && !text) {
    return null;
  }

  return {
    sender,
    text,
    conversationId: getConversationIdFromElement(row as Element),
    conversationPath: getConversationPathFromElement(row as Element),
    avatarUrl: await getAvatarUrlFromElement(row as Element),
  };
}

function countUnreadConversationRows(): number | null {
  const threadRows = getThreadRows();
  if (threadRows.length === 0) {
    return null;
  }

  return threadRows.filter((row) => isUnreadRow(row)).length;
}

async function findBestThreadRow(): Promise<MessagePreview | null> {
  const unreadRows = getUnreadRows();
  for (const row of unreadRows) {
    if (isMutedRow(row)) {
      continue;
    }

    const preview = await extractPreviewFromThreadRow(row);
    if (preview) {
      return preview;
    }
  }

  return null;
}

function trackLatestMessagePreview(): void {
  let lastSentKey = "";
  let lastUnreadRowCount = -1;

  const pushPreview = async () => {
    const unreadRowCount = countUnreadConversationRows();
    if (unreadRowCount !== null && unreadRowCount !== lastUnreadRowCount) {
      lastUnreadRowCount = unreadRowCount;
      ipcRenderer.send("host:unread-count", unreadRowCount);
    }

    const preview = await findBestThreadRow();
    if (!preview) {
      return;
    }

    const key = `${preview.conversationId}|${preview.sender}|${preview.text}`;
    if (key === lastSentKey) {
      return;
    }

    lastSentKey = key;
    ipcRenderer.send("host:message-preview", preview, unreadRowCount);
  };

  const observer = new MutationObserver(() => {
    pushPreview();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  pushPreview();
}

function navigateToConversationInPage(payload: NavigatePayload | null): void {
  if (!payload || typeof payload !== "object") {
    return;
  }

  if (document.readyState === "loading") {
    pendingNavigationPayloads.push(payload);
    window.addEventListener(
      "DOMContentLoaded",
      () => {
        while (pendingNavigationPayloads.length > 0) {
          const queuedPayload = pendingNavigationPayloads.shift();
          if (!queuedPayload) {
            continue;
          }
          navigateToConversationInPage(queuedPayload);
        }
      },
      { once: true },
    );
    return;
  }

  const conversationPath =
    typeof payload.conversationPath === "string"
      ? payload.conversationPath.trim()
      : "";
  const conversationId =
    typeof payload.conversationId === "string"
      ? payload.conversationId.trim()
      : "";

  const candidatePaths: string[] = [];
  if (conversationPath) {
    candidatePaths.push(conversationPath);
  }
  if (conversationId) {
    candidatePaths.push(`/messages/e2ee/t/${conversationId}`);
    candidatePaths.push(`/messages/t/${conversationId}`);
  }

  for (const path of candidatePaths) {
    const link = document.querySelector(`a[href*="${path}"]`);
    if (!link) {
      continue;
    }

    link.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
    return;
  }

  if (conversationPath) {
    history.pushState({}, "", conversationPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

function clickElement(node: Node | null): void {
  if (!node || typeof node.dispatchEvent !== "function") {
    return;
  }

  const element = node as HTMLElement;
  element.focus();
  element.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
    }),
  );
}

function waitForElement(
  getElement: () => Element | null,
  timeoutMs = 1200,
  intervalMs = 50,
): Promise<Element | null> {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    const poll = () => {
      const element = getElement();
      if (element) {
        resolve(element);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        resolve(null);
        return;
      }

      setTimeout(poll, intervalMs);
    };

    poll();
  });
}

function findSettingsButton(): Element | null {
  const selectors = [
    'div[role="button"][aria-controls="mw-inbox-settings-menu"]',
    'div[role="button"][aria-controls*="settings-menu"]',
    'div[role="button"][aria-haspopup="menu"][aria-controls]',
  ];

  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll(selector));
    const visible = elements.find(
      (element) => (element as HTMLElement).offsetParent !== null,
    );
    if (visible) {
      return visible;
    }
    if (elements[0]) {
      return elements[0];
    }
  }

  return null;
}

function getSettingsMenuRoot(): Element | null {
  return (
    document.querySelector("#mw-inbox-settings-menu") ||
    document.querySelector('[role="menu"][id*="settings-menu"]')
  );
}

function findPreferencesMenuItem(): Element | null {
  const menuRoot = getSettingsMenuRoot();
  if (!menuRoot) {
    return null;
  }

  const menuItems = Array.from(menuRoot.querySelectorAll('[role="menuitem"]'));
  if (menuItems.length === 0) {
    return null;
  }

  const firstSeparator = menuRoot.querySelector('[role="separator"]');
  if (!firstSeparator) {
    return menuItems[0] || null;
  }

  return (
    menuItems.find((item) =>
      Boolean(
        firstSeparator.compareDocumentPosition(item) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ) ||
    menuItems[0] ||
    null
  );
}

function findHelpMenuItem(): Element | null {
  const menuRoot = getSettingsMenuRoot();
  if (!menuRoot) {
    return null;
  }

  return (
    menuRoot.querySelector('a[role="menuitem"][href="/help/messenger-app/"]') ||
    null
  );
}

function findProfileMenuButton(): Element | null {
  const navigation = document.querySelector('div[role="navigation"].x6s0dn4');
  if (!navigation) {
    return null;
  }

  const buttons = Array.from(
    navigation.querySelectorAll('div[role="button"]'),
  ).filter((button) => (button as HTMLElement).offsetParent !== null);

  return buttons[buttons.length - 1] || null;
}

function findLogoutMenuButton(): Element | null {
  const dialogs = Array.from(
    document.querySelectorAll('div[role="dialog"][aria-label]'),
  ).filter((dialog) => (dialog as HTMLElement).offsetParent !== null);

  const profileDialog = dialogs[dialogs.length - 1];
  if (!profileDialog) {
    return null;
  }

  const lists = Array.from(profileDialog.querySelectorAll('[role="list"]'));
  let bestItems: Element[] = [];

  for (const list of lists) {
    const items = Array.from(list.querySelectorAll('[role="listitem"]')).filter(
      (item) =>
        item.querySelector('div[role="button"]') &&
        (item as HTMLElement).offsetParent !== null,
    );
    if (items.length > bestItems.length) {
      bestItems = items;
    }
  }

  if (bestItems.length > 0) {
    const lastItem = bestItems[bestItems.length - 1];
    const button = lastItem.querySelector('div[role="button"]');
    if (button) {
      return button;
    }
  }

  const allVisibleButtons = Array.from(
    profileDialog.querySelectorAll('div[role="button"]'),
  ).filter((button) => (button as HTMLElement).offsetParent !== null);

  return allVisibleButtons[allVisibleButtons.length - 1] || null;
}

async function logoutInPage(): Promise<void> {
  const profileButton = await waitForElement(findProfileMenuButton);
  if (!profileButton) {
    return;
  }

  clickElement(profileButton);

  const logoutButton = await waitForElement(findLogoutMenuButton, 1800);
  if (!logoutButton) {
    return;
  }

  clickElement(logoutButton);
}

async function openPreferencesInPage(): Promise<void> {
  const settingsButton = await waitForElement(findSettingsButton);
  if (!settingsButton) {
    return;
  }

  clickElement(settingsButton);

  const preferencesItem = await waitForElement(findPreferencesMenuItem);
  if (!preferencesItem) {
    return;
  }

  clickElement(preferencesItem);
}

async function openHelpCenterInPage(): Promise<void> {
  const settingsButton = await waitForElement(findSettingsButton);
  if (!settingsButton) {
    return;
  }

  clickElement(settingsButton);

  const helpItem = await waitForElement(findHelpMenuItem);
  if (!helpItem) {
    return;
  }

  clickElement(helpItem);
}

function handleGlobalF1Shortcut(event: Event): void {
  const keyEvent = event as KeyboardEvent;
  if (!keyEvent || keyEvent.key !== "F1") {
    return;
  }

  keyEvent.preventDefault();
  keyEvent.stopPropagation();
  keyEvent.stopImmediatePropagation?.();

  openHelpCenterInPage().catch(() => {});
}

window.addEventListener("DOMContentLoaded", () => {
  trackLatestMessagePreview();

  window.addEventListener("keydown", handleGlobalF1Shortcut, true);

  ipcRenderer.on("host:navigate-to-conversation", (_event, payload) => {
    navigateToConversationInPage(payload);
  });

  ipcRenderer.on("host:open-preferences", () => {
    openPreferencesInPage().catch(() => {});
  });

  ipcRenderer.on("host:open-help-center", () => {
    openHelpCenterInPage().catch(() => {});
  });

  ipcRenderer.on("host:log-out", () => {
    logoutInPage().catch(() => {});
  });
});

contextBridge.exposeInMainWorld("poodolHost", {
  ping: () => {
    const unreadRowCount = countUnreadConversationRows();
    if (unreadRowCount !== null) {
      ipcRenderer.send("host:unread-count", unreadRowCount);
    }
  },
});
