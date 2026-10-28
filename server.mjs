
import { createServer } from "node:http";
import { TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";

const PORT = Number(process.env.PORT || 3000);
const USERNAME = (process.env.TIKTOK_USERNAME || "").trim().replace(/^@/, "");
const ENABLE_LIKE_EVENTS =
  (process.env.ENABLE_LIKE_EVENTS || "false").toLowerCase() === "true";

const MAX_COMMENTS = 10;
const MAX_EVENTS = 10;
const MAX_SEEN_IDS = 50;

const comments = [];
const events = [];
const seenEventIds = new Set();

let nextEventId = 0;
let status = USERNAME ? "connecting" : "demo";
let viewerCount = null;
let viewerUpdatedAt = null;
let viewerStatus = "unavailable";

function addComment(user, message, id) {
  if (typeof message !== "string" || !message.trim()) return null;

  const comment = {
    id: String(id || `${Date.now()}-${Math.random()}`),
    user: String(user || "Viewer").slice(0, 40),
    text: message.trim().slice(0, 240)
  };

  comments.push(comment);

  while (comments.length > MAX_COMMENTS) {
    comments.shift();
  }

  return comment;
}

function getUser(data) {
  const user = data?.user || data?.author || {};

  return String(
    user.nickname ||
    user.displayName ||
    user.uniqueId ||
    user.unique_id ||
    data?.nickname ||
    data?.uniqueId ||
    "Viewer"
  ).slice(0, 40);
}

function addEvent(type, username, message, details = {}, externalId) {
  const dedupeId = String(
    externalId || `${type}-${Date.now()}-${Math.random()}`
  );

  if (seenEventIds.has(dedupeId)) return null;

  seenEventIds.add(dedupeId);

  while (seenEventIds.size > MAX_SEEN_IDS) {
    const oldestId = seenEventIds.values().next().value;
    seenEventIds.delete(oldestId);
  }

  const event = {
    id: ++nextEventId,
    type,
    username: String(username || "Viewer").slice(0, 40),
    message: String(message || "").slice(0, 240),
    timestamp: new Date().toISOString(),
    ...details
  };

  events.push(event);

  while (events.length > MAX_EVENTS) {
    events.shift();
  }

  const icons = {
    gift: "🎁",
    follow: "➕",
    like: "❤️",
    share: "🔁",
    chat: "💬"
  };

  // Each event is added to the comments feed exactly once.
  addComment(
    `${icons[type] || "📣"} ${event.username}`,
    event.message,
    `event-${event.id}`
  );

  console.log(`[LIVE EVENT] ${type}: ${event.username} — ${event.message}`);

  return event;
}

function getViewerCount(data) {
  const values = [
    data?.viewerCount,
    data?.viewer_count,
    data?.userCount,
    data?.user_count,
    data?.total
  ];

  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;

    const count = Number(value);

    if (Number.isSafeInteger(count) && count >= 0) {
      return count;
    }
  }

  return null;
}

function getGiftDetails(data) {
  const gift = data?.giftDetails || data?.gift || {};

  const giftName =
    gift.giftName ||
    gift.name ||
    data?.giftName ||
    (data?.giftId != null ? `Gift ${data.giftId}` : "a gift");

  const rawQuantity = Number(data?.repeatCount ?? data?.quantity ?? 1);
  const quantity =
    Number.isSafeInteger(rawQuantity) && rawQuantity > 0
      ? Math.min(rawQuantity, 1000000)
      : 1;

  const rawCoins = Number(
    gift.diamondCount ??
    gift.coins ??
    data?.diamondCount ??
    data?.coins ??
    0
  );

  const coins =
    Number.isFinite(rawCoins) && rawCoins >= 0
      ? Math.min(rawCoins * quantity, Number.MAX_SAFE_INTEGER)
      : 0;

  return {
    giftName: String(giftName).slice(0, 80),
    quantity,
    coins
  };
}

function registerDemoData() {
  addComment("PixelFan", "Hello from the bridge!", "demo-comment-1");
  addComment("Mia", "Testing the Roblox chat overlay!", "demo-comment-2");

  addEvent(
    "gift",
    "DemoViewer",
    "sent Rose ×1 (1 coins) [DEMO]",
    { giftName: "Rose", quantity: 1, coins: 1, demo: true },
    "demo-gift-1"
  );

  addEvent(
    "follow",
    "DemoFan",
    "followed the LIVE! [DEMO]",
    { demo: true },
    "demo-follow-1"
  );
}

function safeHandleEvent(name, handler) {
  return (data) => {
    try {
      handler(data);
    } catch (error) {
      console.error(
        `Failed to process ${name}:`,
        error?.message || error
      );
    }
  };
}

if (!USERNAME) {
  status = "demo";
  registerDemoData();
  console.log("TIKTOK_USERNAME is missing; using demo data.");
} else {
  const connection = new TikTokLiveConnection(USERNAME, {});

  connection.on("connected", () => {
    status = "connected";
    console.log(`Connected to TikTok LIVE: @${USERNAME}`);
  });

  connection.on(
    WebcastEvent.CHAT,
    safeHandleEvent("CHAT", (data) => {
      const username = getUser(data);
      const message = data?.comment ?? data?.text ?? "";

      if (typeof message !== "string" || !message.trim()) return;

      const messageId =
        data?.msgId ??
        data?.messageId ??
        `chat-${Date.now()}-${Math.random()}`;

      // Do not call addComment() here.
      // addEvent() already creates the single feed entry.
      addEvent(
        "chat",
        username,
        message,
        {},
        `chat-${messageId}`
      );
    })
  );

  connection.on(
    WebcastEvent.GIFT,
    safeHandleEvent("GIFT", (data) => {
      const giftType = Number(data?.giftType ?? data?.gift?.giftType ?? 0);

      // Ignore incomplete gift streak updates.
      if (giftType === 1 && data?.repeatEnd === false) return;

      const username = getUser(data);
      const { giftName, quantity, coins } = getGiftDetails(data);
      const message = `sent ${giftName} ×${quantity} (${coins} coins)`;

      addEvent(
        "gift",
        username,
        message,
        { giftName, quantity, coins },
        data?.msgId != null ? `gift-${data.msgId}` : undefined
      );
    })
  );

  connection.on(
    WebcastEvent.FOLLOW,
    safeHandleEvent("FOLLOW", (data) => {
      addEvent(
        "follow",
        getUser(data),
        "followed the LIVE! 👋",
        {},
        data?.msgId != null ? `follow-${data.msgId}` : undefined
      );
    })
  );

  // Likes are disabled unless ENABLE_LIKE_EVENTS=true.
  if (ENABLE_LIKE_EVENTS) {
    connection.on(
      WebcastEvent.LIKE,
      safeHandleEvent("LIKE", (data) => {
        const rawCount = Number(data?.likeCount ?? data?.count ?? 1);
        const count =
          Number.isSafeInteger(rawCount) && rawCount > 0
            ? rawCount
            : 1;

        addEvent(
          "like",
          getUser(data),
          `liked the LIVE ❤️${count > 1 ? ` ×${count}` : ""}`,
          {},
          data?.msgId != null ? `like-${data.msgId}` : undefined
        );
      })
    );
  }

  connection.on(
    WebcastEvent.SHARE,
    safeHandleEvent("SHARE", (data) => {
      addEvent(
        "share",
        getUser(data),
        "shared the LIVE 🔁",
        {},
        data?.msgId != null ? `share-${data.msgId}` : undefined
      );
    })
  );

  // Intentionally no MEMBER/join event handler.
  // Viewer count is tracked separately from the feed.
  connection.on(
    WebcastEvent.ROOM_USER,
    safeHandleEvent("ROOM_USER", (data) => {
      const count = getViewerCount(data);

      if (count !== null) {
        viewerCount = count;
        viewerUpdatedAt = new Date().toISOString();
        viewerStatus = "available";
      }
    })
  );

  connection.on("disconnected", () => {
    status = "disconnected";
    viewerCount = null;
    viewerUpdatedAt = null;
    viewerStatus = "unavailable";
    console.log("Disconnected from TikTok LIVE");
  });

  connection.on("error", (error) => {
    status = "error";
    console.error("TikTok LIVE connection error:", error?.message || error);
  });

  connection.connect().catch((error) => {
    status = "error";
    console.error("TikTok LIVE connection failed:", error?.message || error);
  });
}

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  let url;

  try {
    url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`
    );
  } catch {
    res.writeHead(400);
    return res.end(JSON.stringify({ error: "Invalid URL" }));
  }

  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET, OPTIONS" });
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  const path = url.pathname;

  if (path === "/") {
    return res.end(JSON.stringify({
      ok: true,
      service: "misg TikTok LIVE bridge",
      status,
      endpoints: ["/health", "/comments", "/viewers", "/events"]
    }));
  }

  if (path === "/health") {
    return res.end(JSON.stringify({ ok: true, status }));
  }

  if (path === "/comments") {
    return res.end(JSON.stringify({ status, comments }));
  }

  if (path === "/viewers") {
    return res.end(JSON.stringify({
      status,
      isLive: status === "connected",
      viewerCount,
      updatedAt: viewerUpdatedAt,
      viewerStatus
    }));
  }

  if (path === "/events") {
    const rawAfter = Number(url.searchParams.get("after") || 0);
    const after =
      Number.isSafeInteger(rawAfter) && rawAfter > 0
        ? rawAfter
        : 0;

    return res.end(JSON.stringify({
      status,
      reset: events.length > 0 && after < events[0].id - 1,
      latestId: nextEventId,
      events: events.filter((event) => event.id > after)
    }));
  }

  res.writeHead(404);
  return res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`misg TikTok LIVE bridge listening on port ${PORT}`);
  console.log(`TikTok account: ${USERNAME ? `@${USERNAME}` : "DEMO MODE"}`);
  console.log(`Like events: ${ENABLE_LIKE_EVENTS ? "enabled" : "disabled"}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
