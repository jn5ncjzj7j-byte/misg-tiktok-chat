
import { createServer } from "node:http";
import { TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";

const PORT = Number(process.env.PORT || 3000);
const USERNAME = (process.env.TIKTOK_USERNAME || "").replace(/^@/, "");

const MAX_COMMENTS = 10;
const MAX_EVENTS = 100;

const comments = [];
const events = [];
const seenEventIds = new Set();

let nextEventId = 0;
let status = USERNAME ? "connecting" : "demo";
let viewerCount = null;
let viewerUpdatedAt = null;
let viewerStatus = "unavailable";

function addComment(user, message, id) {
  if (typeof message !== "string" || !message.trim()) return;

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

  return (
    user.nickname ||
    user.displayName ||
    user.uniqueId ||
    user.unique_id ||
    data?.nickname ||
    data?.uniqueId ||
    "Viewer"
  );
}

function addEvent(type, username, message, details = {}, eventId) {
  const id = String(
    eventId || `${type}-${Date.now()}-${Math.random()}`
  );

  if (seenEventIds.has(id)) return;

  seenEventIds.add(id);

  // Keep the deduplication set bounded.
  if (seenEventIds.size > 500) {
    const oldest = seenEventIds.values().next().value;
    seenEventIds.delete(oldest);
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

  // Convert the event into a normal comments-feed entry.
  const icons = {
    gift: "🎁",
    follow: "➕",
    like: "❤️",
    share: "🔁",
    chat: "💬"
  };

  addComment(
    `${icons[type] || "📣"} ${event.username}`,
    event.message,
    `event-${id}`
  );

  console.log(`[LIVE EVENT] ${type}: ${event.username} — ${event.message}`);

  return event;
}

function getViewerCount(data) {
  const possibleValues = [
    data?.viewerCount,
    data?.viewer_count,
    data?.userCount,
    data?.user_count,
    data?.total
  ];

  for (const value of possibleValues) {
    const number = Number(value);

    if (value !== undefined && value !== null && Number.isFinite(number)) {
      return number;
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
    (data?.giftId ? `Gift ${data.giftId}` : "a gift");

  const quantity = Math.max(
    1,
    Number(data?.repeatCount || data?.quantity || 1)
  );

  const coinValue = Number(
    gift.diamondCount ??
    gift.coins ??
    data?.diamondCount ??
    data?.coins ??
    0
  );

  return {
    giftName: String(giftName).slice(0, 80),
    quantity,
    coins: Number.isFinite(coinValue) ? coinValue * quantity : 0
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

if (!USERNAME) {
  status = "demo";
  registerDemoData();
} else {
  const connection = new TikTokLiveConnection(USERNAME, {});

  connection.on("connected", () => {
    status = "connected";
    console.log(`Connected to TikTok LIVE: @${USERNAME}`);
  });

  connection.on(WebcastEvent.CHAT, (data) => {
    const username = getUser(data);
    const message = data?.comment || data?.text || "";

    if (!message.trim()) return;

    const id = String(
      data?.msgId ||
      data?.messageId ||
      `chat-${Date.now()}-${Math.random()}`
    );

    addComment(username, message, id);

    addEvent(
      "chat",
      username,
      message,
      {},
      `chat-event-${id}`
    );
  });

  connection.on(WebcastEvent.GIFT, (data) => {
    // Avoid displaying incomplete gift streak updates.
    const giftType = Number(data?.giftType ?? data?.gift?.giftType ?? 0);
    const repeatEnd = data?.repeatEnd;

    if (giftType === 1 && repeatEnd === false) return;

    const username = getUser(data);
    const { giftName, quantity, coins } = getGiftDetails(data);

    const message =
      `sent ${giftName} ×${quantity} (${coins} coins)`;

    addEvent(
      "gift",
      username,
      message,
      { giftName, quantity, coins },
      data?.msgId ? `gift-${data.msgId}` : undefined
    );
  });

  connection.on(WebcastEvent.FOLLOW, (data) => {
    addEvent(
      "follow",
      getUser(data),
      "followed the LIVE! 👋"
    );
  });

  connection.on(WebcastEvent.LIKE, (data) => {
    const count = Number(data?.likeCount || data?.count || 1);

    addEvent(
      "like",
      getUser(data),
      `liked the LIVE ❤️${count > 1 ? ` ×${count}` : ""}`
    );
  });

  connection.on(WebcastEvent.SHARE, (data) => {
    addEvent(
      "share",
      getUser(data),
      "shared the LIVE 🔁"
    );
  });

  connection.on(WebcastEvent.ROOM_USER, (data) => {
    const count = getViewerCount(data);

    if (count !== null) {
      viewerCount = count;
      viewerUpdatedAt = new Date().toISOString();
      viewerStatus = "available";
    }
  });

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

createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`
  );

  const path = url.pathname;

  if (req.method === "GET" && path === "/") {
    return res.end(JSON.stringify({
      ok: true,
      service: "misg TikTok LIVE bridge",
      status,
      endpoints: ["/health", "/comments", "/viewers", "/events"]
    }));
  }

  if (req.method === "GET" && path === "/health") {
    return res.end(JSON.stringify({ ok: true, status }));
  }

  if (req.method === "GET" && path === "/comments") {
    return res.end(JSON.stringify({ status, comments }));
  }

  if (req.method === "GET" && path === "/viewers") {
    return res.end(JSON.stringify({
      status,
      isLive: status === "connected",
      viewerCount,
      updatedAt: viewerUpdatedAt,
      viewerStatus
    }));
  }

  if (req.method === "GET" && path === "/events") {
    const after = Math.max(0, Number(url.searchParams.get("after") || 0));

    return res.end(JSON.stringify({
      status,
      reset: events.length > 0 && after < events[0].id - 1,
      latestId: nextEventId,
      events: events.filter((event) => event.id > after)
    }));
  }

  res.writeHead(404);
  return res.end(JSON.stringify({ error: "Not found" }));
}).listen(PORT, "0.0.0.0", () => {
  console.log(`misg TikTok LIVE bridge listening on port ${PORT}`);
  console.log(`TikTok account: ${USERNAME ? `@${USERNAME}` : "DEMO MODE"}`);
});
