const fs = require("node:fs");
const path = require("node:path");

const defaultDataDirectory = path.join(__dirname, "..", "data");
const dataFile = process.env.BOT_DATA_FILE
  ? path.resolve(process.env.BOT_DATA_FILE)
  : path.join(defaultDataDirectory, "bot-data.json");
const dataDirectory = path.dirname(dataFile);
const supabaseUrl = (process.env.SUPABASE_URL || "")
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/rest\/v1$/i, "");
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
const supabaseStateId = process.env.SUPABASE_STATE_ID || "discord-clan-bot";

const defaultPanel = {
  title: "Bem-vindo a nossa comunidade",
  description: "Entre diretamente na comunidade ou escolha criar ou participar de um clan!",
  communityLabel: "Comunidade",
  createLabel: "Criar clan",
  joinLabel: "Entrar em clan",
  accentColor: "#5865F2",
  channelId: null,
  messageId: null
};

function emptyState() {
  return { guilds: {}, pendingRequests: {}, pendingInvites: {} };
}

function normalizeState(value) {
  const parsed = value && typeof value === "object" ? value : {};
  return {
    guilds: parsed.guilds && typeof parsed.guilds === "object" ? parsed.guilds : {},
    pendingRequests: parsed.pendingRequests && typeof parsed.pendingRequests === "object"
      ? parsed.pendingRequests
      : {},
    pendingInvites: parsed.pendingInvites && typeof parsed.pendingInvites === "object"
      ? parsed.pendingInvites
      : {}
  };
}

function readLocalState() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  if (!fs.existsSync(dataFile)) return emptyState();

  try {
    return normalizeState(JSON.parse(fs.readFileSync(dataFile, "utf8")));
  } catch (error) {
    console.error("Nao foi possivel ler os dados locais salvos:", error);
    return emptyState();
  }
}

const state = readLocalState();
let requestedRevision = 0;
let persistedRevision = 0;
let saveLoopPromise = null;

function hasSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseKey);
}

function replaceState(nextState) {
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, normalizeState(nextState));
}

function cloneState() {
  return JSON.parse(JSON.stringify(state));
}

function writeLocalState() {
  try {
    fs.mkdirSync(dataDirectory, { recursive: true });
    const temporaryFile = dataFile + ".tmp";
    fs.writeFileSync(temporaryFile, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(temporaryFile, dataFile);
  } catch (error) {
    console.error("Nao foi possivel salvar os dados locais:", error);
  }
}

function supabaseHeaders(extra = {}) {
  const headers = {
    apikey: supabaseKey,
    "Content-Type": "application/json",
    ...extra
  };
  if (supabaseKey.startsWith("eyJ")) headers.Authorization = "Bearer " + supabaseKey;
  return headers;
}

async function requestSupabase(pathname, options = {}) {
  const response = await fetch(supabaseUrl + "/rest/v1/" + pathname, {
    ...options,
    headers: supabaseHeaders(options.headers)
  });

  if (!response.ok) {
    const body = await response.text();
    const schemaHint = response.status === 404
      ? " Execute o arquivo supabase/schema.sql no SQL Editor do Supabase."
      : "";
    throw new Error("Supabase respondeu " + response.status + ": " + body + "." + schemaHint);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function persistSnapshot(snapshot) {
  await requestSupabase("bot_state?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: supabaseStateId,
      data: snapshot,
      updated_at: new Date().toISOString()
    })
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function persistWithRetry(snapshot) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await persistSnapshot(snapshot);
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(attempt * 500);
    }
  }

  console.error("Nao foi possivel salvar os dados no Supabase apos 3 tentativas:", lastError);
  return false;
}

async function runSaveLoop() {
  while (persistedRevision < requestedRevision) {
    const revision = requestedRevision;
    const saved = await persistWithRetry(cloneState());
    if (!saved) break;
    persistedRevision = revision;
  }
}

function queueSupabaseSave() {
  if (!hasSupabaseConfig()) return Promise.resolve();
  requestedRevision += 1;

  if (!saveLoopPromise) {
    saveLoopPromise = runSaveLoop().finally(() => {
      saveLoopPromise = null;
    });
  }

  return saveLoopPromise;
}

function saveState() {
  writeLocalState();
  return queueSupabaseSave();
}

async function initializeStore() {
  if (!hasSupabaseConfig()) {
    console.warn("Supabase nao configurado. Usando somente o armazenamento local.");
    return { source: "local" };
  }

  const query = "bot_state?id=eq." + encodeURIComponent(supabaseStateId) + "&select=data&limit=1";
  const rows = await requestSupabase(query, { method: "GET" });

  if (rows.length > 0) {
    replaceState(rows[0].data);
    writeLocalState();
    console.log("Dados carregados do Supabase.");
    return { source: "supabase" };
  }

  await persistSnapshot(cloneState());
  console.log("Estado inicial enviado ao Supabase.");
  return { source: "local-migrated" };
}

async function flushState() {
  if (!hasSupabaseConfig()) return;
  if (persistedRevision < requestedRevision && !saveLoopPromise) {
    saveLoopPromise = runSaveLoop().finally(() => {
      saveLoopPromise = null;
    });
  }
  if (saveLoopPromise) await saveLoopPromise;
}

function getGuildState(guildId) {
  if (!state.guilds[guildId]) {
    state.guilds[guildId] = {
      panel: { ...defaultPanel },
      clans: {},
      ranking: {},
      matchHistory: [],
      rankingPanel: { channelId: null, messageId: null },
      rankedPanel: { channelId: null, messageId: null },
      cxc: { matches: {} }
    };
  }

  if (state.guilds[guildId].panel?.description === "Para entrar na comunidade, entre em um clan ou crie o seu proprio clan!") {
    state.guilds[guildId].panel.description = defaultPanel.description;
  }

  state.guilds[guildId].panel = { ...defaultPanel, ...state.guilds[guildId].panel };
  state.guilds[guildId].clans ||= {};
  state.guilds[guildId].ranking ||= {};
  state.guilds[guildId].matchHistory ||= [];
  state.guilds[guildId].rankingPanel ||= { channelId: null, messageId: null };
  state.guilds[guildId].rankedPanel ||= { channelId: null, messageId: null };
  state.guilds[guildId].cxc ||= { matches: {} };
  state.guilds[guildId].cxc.matches ||= {};

  return state.guilds[guildId];
}

module.exports = {
  flushState,
  getGuildState,
  hasSupabaseConfig,
  initializeStore,
  saveState,
  state
};
