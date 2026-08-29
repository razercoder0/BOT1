const http = require("node:http");

const DEFAULT_PORT = 10000;
const DEFAULT_KEEP_ALIVE_INTERVAL_MS = 10 * 60 * 1000;

function jsonResponse(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function startKeepAlive() {
  const enabled = process.env.KEEP_ALIVE_ENABLED !== "false" && process.env.RENDER === "true";
  const baseUrl = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL;
  if (!enabled || !baseUrl) return null;

  const interval = Number.parseInt(process.env.KEEP_ALIVE_INTERVAL_MS || "", 10) ||
    DEFAULT_KEEP_ALIVE_INTERVAL_MS;
  const target = new URL("/", baseUrl).toString();

  const ping = async () => {
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) console.warn(`Keep-alive respondeu com status ${response.status}.`);
    } catch (error) {
      console.warn(`Keep-alive nao conseguiu acessar ${target}: ${error.message}`);
    }
  };

  const firstPing = setTimeout(ping, 60 * 1000);
  const timer = setInterval(ping, interval);
  console.log(`Keep-alive ativo a cada ${Math.round(interval / 60000)} minuto(s).`);

  return () => {
    clearTimeout(firstPing);
    clearInterval(timer);
  };
}

function startWebServer(client) {
  const port = Number.parseInt(process.env.PORT || "", 10) || DEFAULT_PORT;

  const server = http.createServer((request, response) => {
    const path = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;

    if (request.method !== "GET") {
      return jsonResponse(response, 405, { status: "method_not_allowed" });
    }

    if (path === "/") {
      return jsonResponse(response, 200, {
        status: "online",
        service: "discord-clan-bot",
        discord: client.isReady() ? "connected" : "connecting"
      });
    }

    if (path === "/health") {
      const discordReady = client.isReady();
      return jsonResponse(response, discordReady ? 200 : 503, {
        status: discordReady ? "healthy" : "starting",
        discord: discordReady ? "connected" : "disconnected",
        guilds: client.guilds.cache.size,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
      });
    }

    return jsonResponse(response, 404, { status: "not_found" });
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`Servidor HTTP online na porta ${port}.`);
  });

  const stopKeepAlive = startKeepAlive();
  return {
    close: () => {
      if (stopKeepAlive) stopKeepAlive();
      server.close();
    }
  };
}

module.exports = { startWebServer };
