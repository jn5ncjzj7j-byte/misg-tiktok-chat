import { createServer } from "node:http";
import { TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";

const PORT = Number(process.env.PORT || 3000);
const USERNAME = (process.env.TIKTOK_USERNAME || "").replace(/^@/, "");
const comments = [];
const MAX_COMMENTS = 100;
let status = USERNAME ? "connecting" : "demo";

function addComment(user, message, id) {
  if (typeof message !== "string" || !message.trim()) return;

  comments.push({
    id: String(id || Date.now() + Math.random()),
    user: String(user || "Viewer").slice(0, 40),
    text: message.trim().slice(0, 240)
  });

  while (comments.length > MAX_COMMENTS) {
    comments.shift();
  }
}

if (!USERNAME) {
  addComment("PixelFan", "Hello from the bridge!", "demo-1");
  addComment("Mia", "Testing the Roblox chat overlay!", "demo-2");
} else {
  const connection = new TikTokLiveConnection(USERNAME, {});

  connection.on("connected", () => {
    status = "connected";
    console.log("TikTok LIVE connected");
  });

  connection.on(WebcastEvent.CHAT, data => {
  console.log("CHAT EVENT RECEIVED:", JSON.stringify({
    user: data.user?.uniqueId || data.user?.nickname,
    comment: data.comment,
    msgId: data.msgId
  }));

  addComment(
    data.user?.uniqueId || data.user?.nickname,
    data.comment,
    data.msgId
  );
});
  connection.on("disconnected", () => {
    status = "disconnected";
  });

  connection.on("error", error => {
    status = "error";
    console.error(String(error));
  });

  connection.connect().catch(error => {
    status = "error";
    console.error(String(error));
  });
}

createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  const path = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`
  ).pathname;

  if (req.method === "GET" && path === "/comments") {
    res.writeHead(200);
    res.end(JSON.stringify({ status, comments }));
    return;
  }

  if (req.method === "GET" && path === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, status }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
}).listen(PORT, "0.0.0.0", () => {
  console.log(`Bridge running on port ${PORT}`);
});
