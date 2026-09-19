// Zoom App host: serves the in-client page, handles the one-time OAuth install, and proxies
// event logging to the review backend so the page stays same-origin (no CORS, no CSP holes).
//
// This server never touches vendors, storage, or candidate media. The only data through it is
// the session log (question + canary events) that the backend already owns.

import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import express from "express";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3400);
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://localhost:8000").replace(/\/$/, "");
const CLIENT_ID = process.env.ZOOM_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET ?? "";

const app = express();
app.disable("x-powered-by");

// Zoom refuses to load an app whose home URL is missing these (OWASP baseline).
app.use((_req, res, next) => {
  res.set({
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "origin",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' https://appssdk.zoom.us",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  });
  next();
});

// --- OAuth install (one-time, from the Marketplace "Add" button) --------------------------

const pendingStates = new Set();

app.get("/install", (_req, res) => {
  if (!CLIENT_ID) return res.status(500).send("ZOOM_CLIENT_ID is not set");
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.add(state);
  const url = new URL("https://zoom.us/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", `${PUBLIC_URL}/auth`);
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

app.get("/auth", async (req, res) => {
  const { code, state } = req.query;
  if (typeof code !== "string") return res.status(400).send("Missing code");
  // The Marketplace "Add" button skips /install, so only enforce state when we issued one.
  if (typeof state === "string" && state && !pendingStates.delete(state)) {
    return res.status(400).send("Unknown state");
  }
  try {
    const token = await exchangeCode(code);
    const deeplink = await getDeeplink(token.access_token);
    res.redirect(deeplink);
  } catch (e) {
    console.error(e);
    res.status(502).send(`Install failed: ${e.message}`);
  }
});

async function exchangeCode(code) {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${PUBLIC_URL}/auth`,
  });
  const r = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`token exchange ${r.status}: ${await r.text()}`);
  return r.json();
}

/** Zoom hands back a zoomapp:// link that opens the installed app in the desktop client. */
async function getDeeplink(accessToken) {
  const r = await fetch("https://api.zoom.us/v2/zoomapp/deeplink", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: JSON.stringify({ url: "/", role_name: "Owner", verified: 1, role_id: 0 }) }),
  });
  if (!r.ok) throw new Error(`deeplink ${r.status}: ${await r.text()}`);
  return (await r.json()).deeplink;
}

// --- Backend proxy: /api/<path> → BACKEND_URL/<path> ------------------------------------------

app.use("/api", express.raw({ type: "*/*", limit: "50mb" }), async (req, res) => {
  const target = `${BACKEND_URL}${req.url}`;
  try {
    const r = await fetch(target, {
      method: req.method,
      headers: req.headers["content-type"] ? { "content-type": req.headers["content-type"] } : undefined,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
    });
    res.status(r.status);
    const type = r.headers.get("content-type");
    if (type) res.set("content-type", type);
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(502).json({ detail: `Review backend unreachable at ${BACKEND_URL}: ${e.message}` });
  }
});

// --- Static: the app itself, and the canary assets the web app already owns ---------------

app.use("/canaries", express.static(path.join(__dirname, "..", "web", "public", "canaries")));
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Zoom app on http://localhost:${PORT}  (public: ${PUBLIC_URL}, backend: ${BACKEND_URL})`);
  if (!CLIENT_ID || !CLIENT_SECRET) console.log("ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET not set — OAuth install will fail.");
});
