import { createServer } from "node:http";
import { TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";
const PORT = Number(process.env.PORT || 3000);
const USERNAME = (process.env.TIKTOK_USERNAME || "").replace(/^@/, "");
const MAX_COMMENTS = 10;
const MAX_EVENTS = 100;
const comments = [];
const events = [];
let nextEventId = 1;
let status = USERNAME ? "connecting" : "demo";
let viewerCount = null;
let viewerUpdatedAt = null;
let viewerStatus = "unavailable";
function addComment(user, message, id) {
  if (typeof message !== "string" || !message.trim()) return;
  comments.push({
    id: String(id || `${Date.now()}-${Math.random()}`),
    user: String(user || "Viewer").slice(0, 40),
    text: message.trim().slice(0, 240)
  });
  while (comments.length > MAX_COMMENTS) comments.shift();
}
function addEvent(type, data) {
  const event = {
    id: nextEventId++,
    type,
    timestamp: new Date().toISOString(),
    ...data
  };
  events.push(event);
  while (events.length > MAX_EVENTS) events.shift();
  console.log("LIVE EVENT:", JSON.stringify(event));
}
function getUser(data) {
  return String(
    data?.user?.uniqueId ||
    data?.user?.nickname ||
    data?.uniqueId ||
    data?.nickname ||
    "Viewer"
  ).slice(0, 40);
}
function getViewerCount(data) {
  const value = data?.viewerCount;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const count = Number(value);
    if (Number.isSafeInteger(count)) return count;
  }
  return null;
}
if (!USERNAME) {
  addComment("PixelFan", "Hello from the bridge!", "demo-1");
  addComment("Mia", "Testing the Roblox chat overlay!", "demo-2");
  addEvent("gift", {
    username: "DemoViewer",
    giftName: "Rose",
    giftId: 5655,
    quantity: 1,
    coins: 1,
    demo: true
  });
} else {
  const connection = new TikTokLiveConnection(USERNAME, {});
  connection.on("connected", () => {
    status = "connected";
    console.log("TikTok LIVE connected:", USERNAME);
  });
  connection.on(WebcastEvent.CHAT, data => {
    const message =
      data.comment ??
      data.text ??
      data.content ??
      data.message ??
      data.chatMessage;
    if (typeof message !== "string" || !message.trim()) return;
    const user = getUser(data);
    addComment(user, message, data.msgId ?? data.messageId ?? data.id);
    addEvent("chat", {
      username: user,
      message: message.trim().slice(0, 240)
    });
  });
  connection.on(WebcastEvent.ROOM_USER, data => {
    const count = getViewerCount(data);
    if (count === null) {
      console.log("Viewer count unavailable:", JSON.stringify(data));
      return;
    }
    viewerCount = count;
    viewerUpdatedAt = new Date().toISOString();
    viewerStatus = "available";
  });
  connection.on(WebcastEvent.GIFT, data => {
    const giftType = Number(data.giftType ?? 0);
    const repeatEnd = data.repeatEnd;
    const repeatCount = Math.max(1, Number(data.repeatCount) || 1);
    if (giftType === 1 && repeatEnd !== true) return;
    const giftName = String(
      data.giftName ??
      data.extendedGiftInfo?.name ??
      "Gift"
    ).slice(0, 80);
    const rawCoins = data.diamondCount ?? data.extendedGiftInfo?.diamond_count;
    const coinsPerGift = Number(rawCoins);
    addEvent("gift", {
      username: getUser(data),
      giftName,
      giftId: data.giftId ?? null,
      quantity: repeatCount,
      coins: Number.isFinite(coinsPerGift) && coinsPerGift >= 0
        ? coinsPerGift * repeatCount
        : null,
      demo: false
    });
  });
  connection.on(WebcastEvent.LIKE, data => {
    addEvent("like", {
      username: getUser(data),
      count: Number(data.likeCount) || 0,
      totalLikes: Number(data.totalLikeCount) || null
    });
  });
  connection.on(WebcastEvent.FOLLOW, data => {
    addEvent("follow", {
      username: getUser(data)
    });
  });
  connection.on(WebcastEvent.SHARE, data => {
    addEvent("share", {
      username: getUser(data)
    });
  });
  connection.on(WebcastEvent.MEMBER, data => {
    addEvent("join", {
      username: getUser(data)
    });
  });
  connection.on("disconnected", () => {
    status = "disconnected";
    viewerCount = null;
    viewerUpdatedAt = null;
    viewerStatus = "unavailable";
    console.log("TikTok LIVE disconnected");
  });
  connection.on("error", error => {
    status = "error";
    console.error("TikTok connection error:", error);
  });
  connection.connect().catch(error => {
    status = "error";
    console.error("TikTok connection failed:", error);
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
    res.end();
    return;
  }
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`
  );
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200);
    res.end(JSON.stringify({
      name: "misg TikTok LIVE Bridge",
      status,
      endpoints: ["/health", "/comments", "/viewers", "/events"]
    }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, status }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/comments") {
    res.writeHead(200);
    res.end(JSON.stringify({ status, comments }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/viewers") {
    res.writeHead(200);
    res.end(JSON.stringify({
      status,
      isLive: status === "connected",
      viewerCount,
      updatedAt: viewerUpdatedAt,
      viewerStatus
    }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/events") {
    const after = Math.max(
      0,
      Number.parseInt(url.searchParams.get("after") || "0", 10) || 0
    );
    const oldestId = events.length ? events[0].id : nextEventId;
    const reset = after > 0 && after < oldestId - 1;
    const newEvents = events.filter(event => event.id > after);
    res.writeHead(200);
    res.end(JSON.stringify({
      status,
      reset,
      latestId: nextEventId - 1,
      events: newEvents
    }));
    return;
  }
  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
}).listen(PORT, "0.0.0.0", () => {
  console.log(`Bridge running on port ${PORT}`);
});
