const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("carrega e salva o estado usando a Secret key do Supabase", async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "clan-store-"));
  const originalFetch = global.fetch;
  const originalEnvironment = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    BOT_DATA_FILE: process.env.BOT_DATA_FILE
  };
  const requests = [];

  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
  process.env.BOT_DATA_FILE = path.join(temporaryDirectory, "bot-data.json");
  global.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if ((options.method || "GET") === "GET") {
      return new Response(JSON.stringify([{
        data: {
          guilds: {
            guild: {
              clans: {},
              ranking: { ABC: { points: 7, wins: 2, losses: 0, matches: 2 } },
              matchHistory: [],
              panel: {},
              rankingPanel: {},
              rankedPanel: {},
              cxc: { matches: {} }
            }
          },
          pendingRequests: {},
          pendingInvites: {}
        }
      }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(null, { status: 204 });
  };

  const storePath = require.resolve("../src/store");
  delete require.cache[storePath];

  try {
    const store = require("../src/store");
    const loaded = await store.initializeStore();
    assert.equal(loaded.source, "supabase");
    assert.equal(store.state.guilds.guild.ranking.ABC.points, 7);
    assert.equal(requests[0].options.headers.apikey, "sb_secret_test");
    assert.equal(requests[0].options.headers.Authorization, undefined);

    store.state.guilds.guild.ranking.ABC.points = 10;
    await store.saveState();

    const saved = JSON.parse(requests.at(-1).options.body);
    assert.equal(saved.data.guilds.guild.ranking.ABC.points, 10);
    assert.equal(saved.id, "discord-clan-bot");
  } finally {
    global.fetch = originalFetch;
    delete require.cache[storePath];
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
