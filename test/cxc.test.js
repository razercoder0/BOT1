const test = require("node:test");
const assert = require("node:assert/strict");

const { commands } = require("../src/deploy-commands");
const {
  cxcChallengeComponents,
  cxcChannelTopic,
  cxcControlComponents,
  cxcHistoryComponents,
  cxcResultReviewComponents,
  cxcSetupBestOfComponents,
  cxcSetupClanComponents,
  cxcSetupConfirmationComponents,
  cxcSetupModeComponents,
  cxcSetupPlayersComponents,
  cxcSummaryComponents,
  cxcWinnerSelectionComponents,
  rankedHubComponents,
  rankedMyMatchesComponents
} = require("../src/index");

const challenger = {
  tag: "MMC",
  name: "Minecraft Masters",
  leaderId: "1543102577045012500"
};
const challenged = {
  tag: "NVD",
  name: "Nova Ordem",
  leaderId: "1543102578886447129"
};
const match = {
  id: "mtest123abc",
  guildId: "1543102574155268231",
  challengerTag: challenger.tag,
  challengedTag: challenged.tag,
  mode: "gapple",
  players: 5,
  bestOf: 3,
  points: 3,
  status: "ACTIVE",
  createdBy: challenger.leaderId,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  channelId: "1543468965685362818",
  winnerTag: challenger.tag,
  loserTag: challenged.tag,
  reportedBy: challenger.leaderId,
  proofUrl: "https://cdn.discordapp.com/attachments/1/2/prova.png"
};

function collectCustomIds(value, found = []) {
  if (!value || typeof value !== "object") return found;
  if (typeof value.custom_id === "string") found.push(value.custom_id);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => collectCustomIds(item, found));
    else collectCustomIds(child, found);
  }
  return found;
}

test("registra todos os subcomandos CXC", () => {
  const command = commands.find((entry) => entry.name === "cxc");
  assert.ok(command);
  const names = command.options.map((option) => option.name);
  assert.deepEqual(names, [
    "painel",
    "desafiar",
    "consultar",
    "cancelar",
    "prova",
    "historico",
    "encerrar",
    "resolver",
    "anular"
  ]);
});

test("todos os paineis CXC geram Components V2 validos", () => {
  const components = [
    cxcChallengeComponents(match, challenger, challenged),
    cxcControlComponents(match, challenger, challenged),
    cxcWinnerSelectionComponents(match, challenger, challenged),
    cxcResultReviewComponents(match, challenger, challenged),
    cxcSummaryComponents(match),
    cxcHistoryComponents(challenger.tag, [match]),
    cxcSetupClanComponents([challenged], challenger.leaderId),
    cxcSetupModeComponents(challenger.leaderId, challenged.tag),
    cxcSetupPlayersComponents(challenger.leaderId, challenged.tag, match.mode),
    cxcSetupBestOfComponents(challenger.leaderId, challenged.tag, match.mode, match.players),
    cxcSetupConfirmationComponents(
      challenger,
      challenged,
      match.mode,
      match.players,
      match.bestOf,
      challenger.leaderId
    ),
    rankedHubComponents(match.guildId),
    rankedMyMatchesComponents(challenger, [match])
  ];

  for (const component of components) {
    const json = component.toJSON();
    assert.equal(json.type, 17);
    for (const customId of collectCustomIds(json)) {
      assert.ok(customId.length <= 100, `custom_id excedeu 100 caracteres: ${customId}`);
    }
  }
});

test("assistente permite 4v4 e formatos de ate 20v20", () => {
  const panel = cxcSetupPlayersComponents(
    challenger.leaderId,
    challenged.tag,
    match.mode
  ).toJSON();
  const select = panel.components
    .flatMap((component) => component.components || [])
    .find((component) => component.custom_id?.startsWith("cxc_setup_players:"));
  assert.ok(select);
  assert.ok(select.options.some((option) => option.value === "4"));
  assert.ok(select.options.some((option) => option.value === "20"));
  assert.equal(select.options.length, 20);
});

test("convite e resultado possuem as acoes esperadas", () => {
  const inviteIds = collectCustomIds(
    cxcChallengeComponents(match, challenger, challenged).toJSON()
  );
  assert.ok(inviteIds.some((id) => id.startsWith("cxc_accept:")));
  assert.ok(inviteIds.some((id) => id.startsWith("cxc_decline:")));

  const resultIds = collectCustomIds(
    cxcResultReviewComponents(match, challenger, challenged).toJSON()
  );
  assert.deepEqual(resultIds.sort(), [
    `cxc_confirm:${match.id}`,
    `cxc_contest:${match.id}`
  ].sort());
});

test("metadados de recuperacao cabem no topico do canal", () => {
  const topic = cxcChannelTopic({
    ...match,
    status: "RESULT_REPORTED",
    proofDeadline: new Date(Date.now() + 60_000).toISOString(),
    controlMessageId: "1543102577045012500",
    resultMessageId: "1543102578886447129"
  });
  assert.ok(topic.startsWith("CXC|"));
  assert.ok(topic.length <= 1024);
});
