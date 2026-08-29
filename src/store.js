const fs = require("node:fs");
const path = require("node:path");

const dataDirectory = path.join(__dirname, "..", "data");
const dataFile = path.join(dataDirectory, "bot-data.json");

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

function readState() {
  fs.mkdirSync(dataDirectory, { recursive: true });

  if (!fs.existsSync(dataFile)) {
    return { guilds: {}, pendingRequests: {}, pendingInvites: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    return {
      guilds: parsed.guilds || {},
      pendingRequests: parsed.pendingRequests || {},
      pendingInvites: parsed.pendingInvites || {}
    };
  } catch (error) {
    console.error("Nao foi possivel ler os dados salvos:", error);
    return { guilds: {}, pendingRequests: {}, pendingInvites: {} };
  }
}

const state = readState();

function saveState() {
  const temporaryFile = `${dataFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(temporaryFile, dataFile);
}

function getGuildState(guildId) {
  if (!state.guilds[guildId]) {
    state.guilds[guildId] = {
      panel: { ...defaultPanel },
      clans: {}
    };
  }

  if (state.guilds[guildId].panel?.description === "Para entrar na comunidade, entre em um clan ou crie o seu proprio clan!") {
    state.guilds[guildId].panel.description = defaultPanel.description;
  }

  state.guilds[guildId].panel = {
    ...defaultPanel,
    ...state.guilds[guildId].panel
  };
  state.guilds[guildId].clans ||= {};

  return state.guilds[guildId];
}

module.exports = {
  getGuildState,
  saveState,
  state
};
