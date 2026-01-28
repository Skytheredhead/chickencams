#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number.parseInt(process.env.AGGREGATOR_UI_PORT ?? "3010", 10);
const defaultServer = process.env.AGGREGATOR_SERVER_HOST ?? "chickens.local";
const defaultPort = Number.parseInt(process.env.AGGREGATOR_SERVER_PORT ?? "9001", 10);
const cameraIds = ["cam1", "cam2", "cam3", "cam4", "cam5"];
const running = new Map();

app.use(express.urlencoded({ extended: false }));

const getVideoDevices = () => {
  try {
    return fs
      .readdirSync("/dev")
      .filter((entry) => entry.startsWith("video"))
      .map((entry) => `/dev/${entry}`)
      .sort();
  } catch {
    return [];
  }
};

const getLanAddresses = () => {
  const interfaces = os.networkInterfaces();
  return Object.values(interfaces)
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
};

const getDefaultPort = (cameraId) => {
  const index = cameraIds.indexOf(cameraId);
  if (index === -1) {
    return defaultPort;
  }
  return defaultPort + index;
};

const renderPage = (message = "") => {
  const devices = getVideoDevices();
  const sessions = Array.from(running.values());
  const addresses = getLanAddresses();
  const addressList = addresses.length ? addresses.join(", ") : "Unavailable";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Chickencams Aggregator</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: system-ui, sans-serif;
        background: #0f1115;
        color: #f4f4f7;
      }
      body {
        margin: 0;
        padding: 24px;
      }
      .container {
        max-width: 880px;
        margin: 0 auto;
      }
      h1 {
        font-size: 28px;
        margin-bottom: 8px;
      }
      .card {
        background: rgba(255, 255, 255, 0.06);
        border-radius: 16px;
        padding: 20px;
        margin-bottom: 20px;
      }
      label {
        display: block;
        font-size: 14px;
        margin-bottom: 6px;
        opacity: 0.8;
      }
      input, select {
        width: 100%;
        padding: 10px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(0, 0, 0, 0.3);
        color: inherit;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px;
      }
      button {
        margin-top: 12px;
        padding: 10px 16px;
        border-radius: 10px;
        border: none;
        cursor: pointer;
        background: #2f6fed;
        color: white;
        font-weight: 600;
      }
      .secondary {
        background: #39404d;
      }
      .message {
        margin-top: 12px;
        color: #9ae6b4;
      }
      .empty {
        opacity: 0.7;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 8px;
      }
      th, td {
        text-align: left;
        padding: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      form.inline {
        display: inline;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Chickencams Aggregator</h1>
      <p>Start USB camera capture streams and send them to the Chickencams server.</p>

      <div class="card">
        <h2>Aggregator IPs</h2>
        <p>${addressList}</p>
      </div>

      <div class="card">
        <h2>Start captures</h2>
        <p>Select up to five inputs (leave as N/A to skip). Default ports increment from ${defaultPort}.</p>
        <form method="post" action="/start">
          <div class="grid">
            <div>
              <label for="serverHost">Server host</label>
              <input name="serverHost" id="serverHost" value="${defaultServer}" required />
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Camera ID</th>
                <th>Video device</th>
                <th>Server port</th>
              </tr>
            </thead>
            <tbody>
              ${cameraIds
                .map(
                  (id) => `
                    <tr>
                      <td>${id}</td>
                      <td>
                        <select name="device_${id}" id="device_${id}">
                          <option value="">N/A</option>
                          ${devices
                            .map((device) => `<option value="${device}">${device}</option>`)
                            .join("")}
                        </select>
                      </td>
                      <td>
                        <input name="serverPort_${id}" id="serverPort_${id}" value="${getDefaultPort(id)}" />
                      </td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
          <button type="submit">Start selected captures</button>
        </form>
        ${message ? `<div class="message">${message}</div>` : ""}
      </div>

      <div class="card">
        <h2>Active captures</h2>
        ${sessions.length
          ? `
            <table>
              <thead>
                <tr>
                  <th>Camera ID</th>
                  <th>Device</th>
                  <th>Server</th>
                  <th>PID</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${sessions
                  .map(
                    (session) => `
                      <tr>
                        <td>${session.cameraId}</td>
                        <td>${session.device}</td>
                        <td>${session.serverHost}:${session.serverPort}</td>
                        <td>${session.pid}</td>
                        <td>
                          <form class="inline" method="post" action="/stop">
                            <input type="hidden" name="cameraId" value="${session.cameraId}" />
                            <button class="secondary" type="submit">Stop</button>
                          </form>
                        </td>
                      </tr>
                    `
                  )
                  .join("")}
              </tbody>
            </table>
          `
          : `<p class="empty">No capture processes running.</p>`}
      </div>
    </div>
  </body>
</html>`;
};

app.get("/", (req, res) => {
  const message = typeof req.query.message === "string" ? req.query.message : "";
  res.send(renderPage(message));
});

app.post("/start", (req, res) => {
  const { serverHost } = req.body;
  if (!serverHost) {
    res.redirect("/?message=Missing+server+host");
    return;
  }

  const capturePath = path.join(__dirname, "capture.sh");
  const started = [];

  cameraIds.forEach((cameraId) => {
    const device = req.body[`device_${cameraId}`];
    const serverPort = req.body[`serverPort_${cameraId}`];

    if (!device) {
      return;
    }

    if (!serverPort) {
      return;
    }

    const existing = running.get(cameraId);
    if (existing) {
      existing.process.kill("SIGTERM");
      running.delete(cameraId);
    }

    const process = spawn(capturePath, [cameraId, device, serverHost, serverPort], {
      stdio: "inherit",
    });

    running.set(cameraId, {
      cameraId,
      device,
      serverHost,
      serverPort,
      pid: process.pid,
      process,
    });

    process.on("exit", () => {
      running.delete(cameraId);
    });

    started.push(`${cameraId} (${device})`);
  });

  if (!started.length) {
    res.redirect("/?message=No+cameras+selected");
    return;
  }

  res.redirect(`/?message=Started+${encodeURIComponent(started.join(",+"))}`);
});

app.post("/stop", (req, res) => {
  const { cameraId } = req.body;
  const session = running.get(cameraId);
  if (session) {
    session.process.kill("SIGTERM");
    running.delete(cameraId);
  }
  res.redirect("/?message=Stopped+capture");
});

app.listen(port, "0.0.0.0", () => {
  const addresses = getLanAddresses();
  const addressList = addresses.length ? addresses : ["<lan-ip>"];
  console.log("Chickencams Aggregator UI running:");
  addressList.forEach((address) => {
    console.log(`  http://${address}:${port}`);
  });
  console.log("Use CTRL+C to stop.");
});
