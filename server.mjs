import { createServer } from "node:http";
import { TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";

const PORT = Number(process.env.PORT || 3000);
const USERNAME = (process.env.TIKTOK_USERNAME || "").replace(/^@/, "");

const comments = [];
const MAX_COMMENTS = 10;

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

  while (comments.length > MAX_COMMENTS) {
    comments.shift();
  }
}

function parseViewerCount(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  return null;
}

function updateViewerCount(data) {
  console.log("ROOM_USER EVENT:", JSON.stringify(data));

  const count = parseViewerCount(data?.viewerCount)
    ?? parseViewerCount(data?.data?.viewerCount)
    ?? parseViewerCount(data?.total);

  if (count === null) {
    console.log("No verified viewer count field found in ROOM_USER event.");
    return;
  }

  viewerCount = count;
  viewerUpdatedAt = new Date().toISOString();
  viewerStatus = "available";

  console.log("CURRENT LIVE VIEWERS:", viewerCount);
}

if (!USERNAME) {
  addComment("PixelFan", "Hello from the bridge!", "demo-1");
  addComment("Mia", "Testing the Roblox chat overlay!", "demo-2");
} else {
  const connection = new TikTokLiveConnection(USERNAME, {});

  connection.on("connected", () => {
    status = "connected";
    console.log("TikTok LIVE connected:", USERNAME);
  });

  connection.on(WebcastEvent.CHAT, data => {
    const user =
      data.user?.uniqueId ||
      data.user?.nickname ||
      data.nickname ||
      data.uniqueId ||
      "Viewer";

    const message =
      data.comment ??
      data.text ??
      data.content ??
      data.message ??
      data.chatMessage ??
      data.data?.comment ??
      data.data?.text;

    const id =
      data.msgId ??
      data.messageId ??
      data.id ??
      data.common?.msgId;

    if (typeof message === "string" && message.trim()) {
      addComment(user, message, id);
      console.log("COMMENT SAVED:", user, message);
    } else {
      console.log("MESSAGE FIELD NOT FOUND");
    }
  });

  connection.on(WebcastEvent.ROOM_USER, data => {
    updateViewerCount(data);
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

  const path = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`
  ).pathname;

  if (req.method === "GET" && path === "/comments") {
    res.writeHead(200);
    res.end(JSON.stringify({ status, comments }));
    return;
  }

  if (req.method === "GET" && path === "/viewers") {
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

  if (req.method === "GET" && path === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({
      ok: true,
      status,
      viewerStatus
    }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
}).listen(PORT, "0.0.0.0", () => {
  console.log(`Bridge running on port ${PORT}`);
});
