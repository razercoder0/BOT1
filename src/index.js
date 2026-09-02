require("dotenv").config();

const { randomBytes } = require("node:crypto");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  ContainerBuilder,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder
} = require("discord.js");
const { getGuildState, saveState, state } = require("./store");
const { startWebServer } = require("./web-server");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});
client.on("error", (error) => {
  console.error("Erro interno do cliente Discord:", error);
});

const creatingClans = new Set();
const panelPublishLocks = new Map();
const rankingPanelPublishLocks = new Map();
const rankedPanelPublishLocks = new Map();
const clanGuidePublishLocks = new Map();
const cxcActionLocks = new Set();
const legacyPublicChatSetting = process.env.PUBLIC_CHAT_NAME || "chat-publico";
const publicChatId = process.env.PUBLIC_CHAT_ID || (/^\d{17,20}$/.test(legacyPublicChatSetting) ? legacyPublicChatSetting : null);
const publicChatName = /^\d{17,20}$/.test(legacyPublicChatSetting) ? "chat-publico" : legacyPublicChatSetting;
const createPublicChat = process.env.CREATE_PUBLIC_CHAT === "true";
const communityRoleId = process.env.COMMUNITY_ROLE_ID;
const adminRoleIds = new Set(
  (process.env.ADMIN_ROLE_IDS || "")
    .split(",")
    .map((roleId) => roleId.trim())
    .filter((roleId) => /^\d{17,20}$/.test(roleId))
);
const accessChannelId = process.env.ACCESS_CHANNEL_ID || "1543103438148341862";
const accessChannelName = process.env.ACCESS_CHANNEL_NAME || "acesso";
const rankingChannelId = process.env.RANKING_CHANNEL_ID || "1543468965685362818";
const rankedChannelId = process.env.RANKED_CHANNEL_ID || "1544491523977252966";
const rankedChannelName = process.env.RANKED_CHANNEL_NAME || "ranked";
const clanCategoryName = process.env.CLAN_CATEGORY_NAME || "CLANS";
const cxcCategoryId = process.env.CXC_CATEGORY_ID || "1543102614001025054";
const cxcCategoryName = process.env.CXC_CATEGORY_NAME || "CONFRONTOS CXC";
const configuredCxcPoints = Number.parseInt(process.env.CXC_WIN_POINTS || "3", 10);
const cxcWinPoints = Number.isInteger(configuredCxcPoints) && configuredCxcPoints > 0
  ? configuredCxcPoints
  : 3;
const cxcInvitationLifetime = 24 * 60 * 60 * 1000;
const cxcOpenStatuses = new Set([
  "PENDING",
  "ACTIVE",
  "AWAITING_PROOF",
  "RESULT_REPORTED",
  "CONTESTED"
]);
const cxcModeLabels = {
  gapple: "Gapple",
  nodebuff: "NoDebuff"
};

function cleanTag(tag) {
  return tag.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function makeClanRoleName(tag) {
  return `Clan ${cleanTag(tag)}`;
}

function makeLeaderRoleName(tag) {
  return `Lider ${cleanTag(tag)}`;
}

function makeChannelName(tag, prefix) {
  return `${prefix}-${cleanTag(tag).toLowerCase()}`;
}

function getClan(guildId, tag) {
  return getGuildState(guildId).clans[cleanTag(tag)];
}

function getClans(guildId) {
  return Object.values(getGuildState(guildId).clans);
}

function makeCxcId() {
  return `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
}

function getCxcMatches(guildId) {
  return getGuildState(guildId).cxc.matches;
}

function getCxcMatch(guildId, matchId) {
  return getCxcMatches(guildId)[matchId] || null;
}

function findCxcByChannel(guildId, channelId) {
  return Object.values(getCxcMatches(guildId))
    .find((match) => match.channelId === channelId) || null;
}

function findOpenCxcForClan(guildId, tag) {
  const matches = Object.values(getCxcMatches(guildId));
  let expired = false;
  for (const match of matches) {
    if (match.status === "PENDING" && match.expiresAt &&
        Date.now() > new Date(match.expiresAt).getTime()) {
      match.status = "CANCELLED";
      match.cancelledAt = new Date().toISOString();
      expired = true;
    }
  }
  if (expired) saveState();

  return matches
    .filter((match) =>
      cxcOpenStatuses.has(match.status) &&
      [match.challengerTag, match.challengedTag].includes(tag)
    )
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt))[0] || null;
}

function cxcModeLabel(mode) {
  return cxcModeLabels[mode] || mode;
}

function cxcStatusLabel(status) {
  return {
    PENDING: "Aguardando aceite",
    ACTIVE: "Em andamento",
    AWAITING_PROOF: "Aguardando prova",
    RESULT_REPORTED: "Aguardando confirmacao",
    CONTESTED: "Contestado",
    CONFIRMED: "Confirmado",
    CANCELLED: "Cancelado",
    ANNULLED: "Anulado"
  }[status] || status;
}

function cxcInvitationCustomId(action, match) {
  return [
    `cxc_${action}`,
    match.id,
    match.challengerTag,
    match.challengedTag,
    match.mode,
    match.players,
    match.bestOf
  ].join(":");
}

function getRankingEntries(guildId) {
  const guildState = getGuildState(guildId);
  return getClans(guildId)
    .map((clan) => ({
      tag: clan.tag,
      name: clan.name,
      points: 0,
      wins: 0,
      losses: 0,
      matches: 0,
      ...guildState.ranking[clan.tag]
    }))
    .sort((first, second) =>
      second.points - first.points ||
      second.wins - first.wins ||
      first.losses - second.losses ||
      first.tag.localeCompare(second.tag)
    );
}

function parseColor(color) {
  const normalized = color.trim().replace(/^#/, "");
  return /^[0-9A-F]{6}$/i.test(normalized) ? Number.parseInt(normalized, 16) : null;
}

function panelComponents(panel) {
  const color = parseColor(panel.accentColor) ?? 0x5865f2;
  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("panel_community")
      .setLabel(panel.communityLabel)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("panel_create_clan")
      .setLabel(panel.createLabel)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("panel_join_clan")
      .setLabel(panel.joinLabel)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("panel_edit")
      .setLabel("Editar painel")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("panel_ranking")
      .setLabel("Ranking")
      .setStyle(ButtonStyle.Secondary)
  );

  return new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${panel.title}\n${panel.description}`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Escolha como deseja continuar\n" +
        "Entre diretamente na comunidade, crie um novo clan ou solicite entrada em um clan existente."
      )
    )
    .addActionRowComponents(actions)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "-# Cada clan recebe cargo, chat privado e call privada. A entrada de membros depende da aprovacao do lider."
      )
    );
}

function statusComponents(title, description, color = 0x5865f2) {
  return new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${title}\n${description}`)
    );
}

function rankingComponents(guildId, fixed = false) {
  const entries = getRankingEntries(guildId);
  const table = entries.length === 0
    ? "Nenhum clan cadastrado no momento."
    : entries.slice(0, 20).map((entry, index) =>
      `**${index + 1}. ${entry.tag}** - ${entry.points} pts\n-# ${entry.wins}V  |  ${entry.losses}D  |  ${entry.matches} partida(s)  |  ${entry.name}`
    ).join("\n\n");

  const container = new ContainerBuilder()
    .setAccentColor(0xf59e0b)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# Ranking de clans\nClassificacao oficial da comunidade.")
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(table))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("-# Criterios: pontos, vitorias, menos derrotas e ordem alfabetica.")
    );

  if (fixed) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("ranking_fixed_refresh")
            .setLabel("Atualizar ranking")
            .setStyle(ButtonStyle.Secondary)
        )
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Atualizado <t:${Math.floor(Date.now() / 1000)}:R>.`)
      );
  }

  return container;
}

function rankedHubComponents(guildId) {
  const matches = Object.values(getCxcMatches(guildId));
  const pending = matches.filter((match) => match.status === "PENDING").length;
  const active = matches.filter((match) =>
    ["ACTIVE", "AWAITING_PROOF", "RESULT_REPORTED", "CONTESTED"].includes(match.status)
  ).length;

  return new ContainerBuilder()
    .setAccentColor(0x22c55e)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "# Central Ranked de Clans\nCrie um confronto oficial contra outro clan."
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Temporada atual\n**Clans cadastrados:** ${getClans(guildId).length}\n**Desafios aguardando aceite:** ${pending}\n**Confrontos em andamento:** ${active}`
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("ranked_create")
          .setLabel("Criar desafio")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("ranked_matches")
          .setLabel("Meus confrontos")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("ranked_ranking")
          .setLabel("Ranking")
          .setStyle(ButtonStyle.Secondary)
      )
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "-# Somente lideres podem criar desafios. Convites chegam no chat privado do clan adversario."
      )
    );
}

function cxcSetupStepComponents(title, description, select, footer) {
  return new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${title}\n${description}`)
    )
    .addActionRowComponents(new ActionRowBuilder().addComponents(select))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footer}`));
}

function cxcSetupClanComponents(opponents, userId) {
  const options = opponents.slice(0, 25).map((clan) => ({
    label: `${clan.tag} - ${clan.name}`.slice(0, 100),
    description: `Desafiar o clan ${clan.tag}`,
    value: clan.tag
  }));
  const select = new StringSelectMenuBuilder()
    .setCustomId(`cxc_setup_clan:${userId}`)
    .setPlaceholder("Selecione o clan adversario")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);
  return cxcSetupStepComponents(
    "Criar desafio - Clan adversario",
    "Escolha qual clan recebera o convite oficial.",
    select,
    opponents.length > 25
      ? "Mostrando os 25 primeiros clans. Use /cxc desafiar se o clan nao estiver na lista."
      : "Etapa 1 de 4. Apenas voce pode continuar esta configuracao."
  );
}

function cxcSetupModeComponents(userId, challengedTag) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`cxc_setup_mode:${userId}:${challengedTag}`)
    .setPlaceholder("Selecione o modo")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      { label: "Gapple", description: "Confronto no modo Gapple", value: "gapple" },
      { label: "NoDebuff", description: "Confronto no modo NoDebuff", value: "nodebuff" }
    );
  return cxcSetupStepComponents(
    "Criar desafio - Modo",
    `Clan adversario: **${challengedTag}**\nEscolha o modo da partida.`,
    select,
    "Etapa 2 de 4. O modo sera exibido no convite e no canal privado."
  );
}

function cxcSetupPlayersComponents(userId, challengedTag, mode) {
  const options = Array.from({ length: 20 }, (_, index) => {
    const players = index + 1;
    return {
      label: `${players}v${players}`,
      description: `${players} jogador(es) por clan`,
      value: String(players)
    };
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId(`cxc_setup_players:${userId}:${challengedTag}:${mode}`)
    .setPlaceholder("Selecione o formato")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);
  return cxcSetupStepComponents(
    "Criar desafio - Formato",
    `**Adversario:** ${challengedTag}\n**Modo:** ${cxcModeLabel(mode)}\nEscolha de 1v1 ate 20v20.`,
    select,
    "Etapa 3 de 4. Os dois clans precisam ter membros suficientes cadastrados."
  );
}

function cxcSetupBestOfComponents(userId, challengedTag, mode, players) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`cxc_setup_bestof:${userId}:${challengedTag}:${mode}:${players}`)
    .setPlaceholder("Selecione a serie")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      { label: "MD1", description: "Uma partida decide o confronto", value: "1" },
      { label: "MD3", description: "Melhor de tres partidas", value: "3" },
      { label: "MD5", description: "Melhor de cinco partidas", value: "5" }
    );
  return cxcSetupStepComponents(
    "Criar desafio - Serie",
    `**Adversario:** ${challengedTag}\n**Modo:** ${cxcModeLabel(mode)}\n**Formato:** ${players}v${players}`,
    select,
    "Etapa 4 de 4. Depois voce revisara tudo antes de enviar."
  );
}

function cxcSetupConfirmationComponents(challenger, challenged, mode, players, bestOf, userId) {
  return new ContainerBuilder()
    .setAccentColor(0xf59e0b)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Confirmar desafio\n**${challenger.tag} - ${challenger.name}** deseja desafiar **${challenged.tag} - ${challenged.name}**.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Configuracao\n**Modo:** ${cxcModeLabel(mode)}\n**Formato:** ${players}v${players}\n**Serie:** MD${bestOf}\n**Premio:** ${cxcWinPoints} pontos`
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`cxc_setup_send:${userId}:${challenged.tag}:${mode}:${players}:${bestOf}`)
          .setLabel("Enviar desafio")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`cxc_setup_cancel:${userId}`)
          .setLabel("Cancelar")
          .setStyle(ButtonStyle.Secondary)
      )
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# O convite sera publicado no chat privado do clan ${challenged.tag}. Somente o lider adversario podera responder.`
      )
    );
}

function rankedMyMatchesComponents(clan, matches) {
  const rows = matches.length
    ? matches.slice(0, 10).map((match) =>
      `**${match.challengerTag} x ${match.challengedTag}** - ${cxcStatusLabel(match.status)}\n-# ${cxcModeLabel(match.mode)} | ${match.players}v${match.players} | MD${match.bestOf} | ID: ${match.id}`
    ).join("\n\n")
    : "Seu clan ainda nao possui confrontos registrados.";
  return new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# Confrontos do clan ${clan.tag}\n${rows}`)
    );
}

function cxcChallengeComponents(match, challenger, challenged) {
  const expiresAt = Math.floor(new Date(match.expiresAt).getTime() / 1000);
  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cxcInvitationCustomId("accept", match))
      .setLabel("Aceitar confronto")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(cxcInvitationCustomId("decline", match))
      .setLabel("Recusar")
      .setStyle(ButtonStyle.Danger)
  );

  return new ContainerBuilder()
    .setAccentColor(0xef4444)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Desafio CXC recebido\n<@${challenged.leaderId}>, o clan **${challenger.tag} - ${challenger.name}** desafiou sua equipe.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Configuracao\n**Confronto:** ${challenger.tag} x ${challenged.tag}\n**Modo:** ${cxcModeLabel(match.mode)}\n**Formato:** ${match.players}x${match.players}\n**Serie:** MD${match.bestOf}\n**Premio:** ${match.points} pontos no ranking`
      )
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Responsaveis\n**Desafiante:** <@${challenger.leaderId}>\n**Desafiado:** <@${challenged.leaderId}>`
      )
    )
    .addActionRowComponents(actions)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# Somente o lider do clan ${challenged.tag} pode responder. O convite expira <t:${expiresAt}:R>. ID: ${match.id}`
      )
    );
}

function cxcClosedInvitationComponents(match, title, description, color = 0x5865f2) {
  return new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${title}\n${description}`)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# ${match.challengerTag} x ${match.challengedTag} | ${cxcModeLabel(match.mode)} | ${match.players}x${match.players} | MD${match.bestOf} | ID: ${match.id}`
      )
    );
}

function cxcControlComponents(match, challenger, challenged) {
  const container = new ContainerBuilder()
    .setAccentColor(match.status === "CONTESTED" ? 0xef4444 : 0x5865f2)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Confronto ${challenger.tag} x ${challenged.tag}\n<@${challenger.leaderId}> <@${challenged.leaderId}> enviem o duelo no servidor e realizem a serie combinada.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Regras da partida\n**Modo:** ${cxcModeLabel(match.mode)}\n**Formato:** ${match.players}x${match.players}\n**Serie:** MD${match.bestOf}\n**Pontuacao:** ${match.points} pontos para o vencedor\n**Status:** ${cxcStatusLabel(match.status)}`
      )
    );

  if (match.status === "ACTIVE" || match.status === "AWAITING_PROOF") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`cxc_report:${match.id}`)
          .setLabel("Informar vencedor")
          .setStyle(ButtonStyle.Primary)
      )
    );
  }

  return container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "-# Um lider informa o vencedor e envia a print. O outro lider precisa confirmar antes dos pontos entrarem no ranking."
    )
  );
}

function cxcWinnerSelectionComponents(match, challenger, challenged) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`cxc_winner:${match.id}`)
    .setPlaceholder("Selecione o clan vencedor")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      {
        label: `${challenger.tag} - ${challenger.name}`.slice(0, 100),
        description: `Declarar ${challenger.tag} como vencedor`,
        value: challenger.tag
      },
      {
        label: `${challenged.tag} - ${challenged.name}`.slice(0, 100),
        description: `Declarar ${challenged.tag} como vencedor`,
        value: challenged.tag
      }
    );

  return new ContainerBuilder()
    .setAccentColor(0xf59e0b)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "# Informar vencedor\nSelecione quem venceu. Depois, voce tera **5 minutos** para usar `/cxc prova` e anexar a print da vitoria."
      )
    )
    .addActionRowComponents(new ActionRowBuilder().addComponents(select))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("-# Somente um dos dois lideres pode realizar esta acao.")
    );
}

function cxcResultReviewComponents(match, winner, loser) {
  return new ContainerBuilder()
    .setAccentColor(0xf59e0b)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Resultado informado\n**${winner.tag} - ${winner.name}** foi selecionado como vencedor contra **${loser.tag}**.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Prova da vitoria\n[Abra a print enviada pelo lider](${match.proofUrl})\n\n**Informado por:** <@${match.reportedBy}>\n**Pontos aguardando confirmacao:** ${match.points}`
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`cxc_confirm:${match.id}`)
          .setLabel("Confirmar vencedora")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`cxc_contest:${match.id}`)
          .setLabel("Contestar resultado")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setLabel("Abrir prova")
          .setStyle(ButtonStyle.Link)
          .setURL(match.proofUrl)
      )
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "-# Apenas o outro lider pode confirmar ou contestar. Os pontos ainda nao foram aplicados."
      )
    );
}

function cxcSummaryComponents(match) {
  const proof = match.proofUrl ? `\n**Prova:** [abrir imagem](${match.proofUrl})` : "";
  const winner = match.winnerTag ? `\n**Vencedora:** ${match.winnerTag}` : "";
  const channel = match.channelId ? `\n**Canal:** <#${match.channelId}>` : "";
  return new ContainerBuilder()
    .setAccentColor(match.status === "CONTESTED" ? 0xef4444 : 0x5865f2)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# CXC ${match.challengerTag} x ${match.challengedTag}\n**Status:** ${cxcStatusLabel(match.status)}\n**Modo:** ${cxcModeLabel(match.mode)}\n**Formato:** ${match.players}x${match.players}\n**Serie:** MD${match.bestOf}${winner}${channel}${proof}`
      )
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ID: ${match.id} | Criado <t:${Math.floor(new Date(match.createdAt).getTime() / 1000)}:R>.`)
    );
}

function cxcHistoryComponents(tag, matches) {
  const rows = matches.length
    ? matches.slice(0, 10).map((match) => {
      const result = match.winnerTag ? ` | Vencedora: **${match.winnerTag}**` : "";
      return `**${match.challengerTag} x ${match.challengedTag}** - ${cxcStatusLabel(match.status)}${result}\n-# ${cxcModeLabel(match.mode)} | ${match.players}x${match.players} | MD${match.bestOf} | ID: ${match.id}`;
    }).join("\n\n")
    : "Nenhum confronto encontrado.";

  return new ContainerBuilder()
    .setAccentColor(0x8b5cf6)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# Historico CXC de ${tag}\n${rows}`)
    );
}

function clanCreatedComponents(clan, leader, guildId) {
  return new ContainerBuilder()
    .setAccentColor(0x22c55e)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Clan criado com sucesso\n**${clan.tag} - ${clan.name}** ja esta pronto para receber sua equipe.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Estrutura criada\n**Lider:** ${leader}\n**Cargo:** <@&${clan.roleId}>\n**Chat privado:** <#${clan.textChannelId}>\n**Call privada:** <#${clan.voiceChannelId}>`
      )
    )
    .addActionRowComponents(clanLinkButtons(clan, guildId))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("-# A central de recrutamento e gerenciamento foi publicada no chat privado do clan.")
    );
}

function requestComponents(clan, requester, requestId) {
  return new ContainerBuilder()
    .setAccentColor(0xf59e0b)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Pedido de entrada\n${requester} quer entrar no clan **${clan.tag} - ${clan.name}**.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Decisao do lider\nAceite para liberar os cargos, o chat e a call. Recuse para encerrar o pedido.")
    )
    .addActionRowComponents(approvalButtons(requestId))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("-# Status: aguardando sua resposta."));
}

function inviteComponents(clan, inviter, inviteId) {
  return new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Convite para o clan ${clan.tag}\n${inviter} convidou voce para fazer parte do **${clan.name}**.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## O que sera liberado\n- Cargo da comunidade\n- Cargo exclusivo do clan\n- Chat privado da equipe\n- Call privada"
      )
    )
    .addActionRowComponents(inviteButtons(inviteId))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("-# O acesso so sera alterado depois que voce aceitar."));
}

function clanInviteSelectRow(tag) {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`clan_invite_select:${tag}`)
      .setPlaceholder("Selecione um membro para convidar")
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function clanLinkButtons(clan, guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Abrir chat")
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${guildId}/${clan.textChannelId}`),
    new ButtonBuilder()
      .setLabel("Abrir call")
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${guildId}/${clan.voiceChannelId}`)
  );
}

function clanGuideComponents(clan, guildId) {
  return new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Central do clan ${clan.tag}\nBem-vindos ao espaco privado do **${clan.name}**.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Estrutura da equipe\n**Lider:** <@${clan.leaderId}>\n**Cargo:** <@&${clan.roleId}>\n**Membros cadastrados:** ${clan.members.length}\n**Call privada:** <#${clan.voiceChannelId}>`
      )
    )
    .addActionRowComponents(clanLinkButtons(clan, guildId))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Recrutamento\nO lider pode selecionar uma pessoa abaixo. Ela recebera um convite privado com as opcoes de aceitar ou recusar."
      )
    )
    .addActionRowComponents(clanInviteSelectRow(clan.tag))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Gerenciamento\n`/clan painel` consulta a equipe.\n`/clan remover usuario:@pessoa` remove um membro.\n`/cxc desafiar` envia um desafio oficial para outro clan.\nPedidos feitos no canal de acesso chegam no privado do lider."
      )
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("-# Somente o lider pode usar o seletor de convites e os comandos de gerenciamento.")
    );
}

function clanPanelComponents(clan, guildId, isLeader) {
  const container = new ContainerBuilder()
    .setAccentColor(0x8b5cf6)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# Painel do clan ${clan.tag}\n**${clan.name}**`)
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Visao geral\n**Lider:** <@${clan.leaderId}>\n**Membros:** ${clan.members.length}\n**Cargo:** <@&${clan.roleId}>\n**Chat:** <#${clan.textChannelId}>\n**Call:** <#${clan.voiceChannelId}>`
      )
    )
    .addActionRowComponents(clanLinkButtons(clan, guildId));

  if (isLeader) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent("## Convidar membro\nSelecione uma pessoa para enviar um convite privado."))
      .addActionRowComponents(clanInviteSelectRow(clan.tag));
  }

  return container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(isLeader ? "-# Voce esta visualizando como lider." : "-# Voce esta visualizando como membro.")
  );
}

function approvalButtons(requestId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`clan_accept:${requestId}`)
      .setLabel("Aceitar")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`clan_deny:${requestId}`)
      .setLabel("Recusar")
      .setStyle(ButtonStyle.Danger)
  );
}

function inviteButtons(inviteId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`clan_invite_accept:${inviteId}`)
      .setLabel("Aceitar convite")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`clan_invite_deny:${inviteId}`)
      .setLabel("Recusar")
      .setStyle(ButtonStyle.Danger)
  );
}

function resetClanButtons(guildId, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reset_clans_confirm:${guildId}:${userId}`)
      .setLabel("Confirmar reset")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`reset_clans_cancel:${guildId}:${userId}`)
      .setLabel("Cancelar")
      .setStyle(ButtonStyle.Secondary)
  );
}

function resetWarningComponents(clanCount, guildId, userId) {
  return new ContainerBuilder()
    .setAccentColor(0xef4444)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Confirmar reset de clans\nEsta acao removera **${clanCount} clan(s)**, cargos, chats privados, calls, convites e pedidos pendentes.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Sera preservado\n- Painel e canal de acesso\n- Cargo da comunidade\n- Chat publico\n\n**Esta acao nao pode ser desfeita pelo bot.**"
      )
    )
    .addActionRowComponents(resetClanButtons(guildId, userId));
}

function undoClanButtons(guildId, tag, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`undo_clan_confirm:${guildId}:${tag}:${userId}`)
      .setLabel("Confirmar exclusao")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`undo_clan_cancel:${guildId}:${tag}:${userId}`)
      .setLabel("Cancelar")
      .setStyle(ButtonStyle.Secondary)
  );
}

function undoClanWarningComponents(clan, guildId, userId) {
  return new ContainerBuilder()
    .setAccentColor(0xef4444)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Desfazer clan ${clan.tag}\nVoce esta prestes a excluir permanentemente o clan **${clan.name}**.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Recursos que serao removidos\n**Cargo:** <@&${clan.roleId}>\n**Cargo de lider:** <@&${clan.leaderRoleId}>\n**Chat:** <#${clan.textChannelId}>\n**Call:** <#${clan.voiceChannelId}>\n**Membros cadastrados:** ${clan.members.length}`
      )
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "-# O cargo da comunidade, o painel de acesso e os outros clans serao preservados."
      )
    )
    .addActionRowComponents(undoClanButtons(guildId, clan.tag, userId));
}

function resultButtons(guildId, winnerTag, loserTag, points, userId, resultId) {
  const encoded = `${guildId}:${winnerTag}:${loserTag}:${points}:${userId}:${resultId}`;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rank_ok:${encoded}`)
      .setLabel("Confirmar resultado")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`rank_no:${encoded}`)
      .setLabel("Cancelar")
      .setStyle(ButtonStyle.Secondary)
  );
}

function resultWarningComponents(winner, loser, points, guildId, userId, resultId) {
  return new ContainerBuilder()
    .setAccentColor(0xf59e0b)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Confirmar resultado\n**${winner.tag} - ${winner.name}** venceu **${loser.tag} - ${loser.name}**.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Alteracao no ranking\n**Vencedora:** +${points} pontos e +1 vitoria\n**Perdedora:** +1 derrota\n**Partidas:** +1 para cada clan`
      )
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("-# Confira as tags antes de confirmar. O resultado sera salvo imediatamente.")
    )
    .addActionRowComponents(resultButtons(guildId, winner.tag, loser.tag, points, userId, resultId));
}

function removeResultWarningComponents(match, winner, loser, guildId, userId) {
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rank_remove_ok:${guildId}:${match.id}:${userId}`)
      .setLabel("Confirmar retirada")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`rank_remove_no:${guildId}:${match.id}:${userId}`)
      .setLabel("Cancelar")
      .setStyle(ButtonStyle.Secondary)
  );

  return new ContainerBuilder()
    .setAccentColor(0xef4444)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Retirar resultado\nA partida mais recente em que **${winner.tag}** venceu **${loser.tag}** sera desfeita.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${winner.tag}:** -${match.points} pontos, -1 vitoria e -1 partida\n**${loser.tag}:** -1 derrota e -1 partida`
      )
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("-# Esta acao remove o registro da partida e atualiza o painel automaticamente.")
    )
    .addActionRowComponents(buttons);
}

function resetRankingWarningComponents(matchCount, guildId, userId) {
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rank_reset_ok:${guildId}:${userId}`)
      .setLabel("Zerar ranking")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`rank_reset_no:${guildId}:${userId}`)
      .setLabel("Cancelar")
      .setStyle(ButtonStyle.Secondary)
  );

  return new ContainerBuilder()
    .setAccentColor(0xef4444)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Zerar ranking\nEsta acao removera os pontos, vitorias, derrotas e **${matchCount} partida(s)** do historico.`
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Os clans, cargos, membros, chats e calls serao preservados.")
    )
    .addActionRowComponents(buttons);
}

function createClanModal() {
  return new ModalBuilder()
    .setCustomId("modal_create_clan")
    .setTitle("Criar um clan")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("clan_tag")
          .setLabel("Tag do clan")
          .setPlaceholder("Exemplo: ABC")
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(8)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("clan_name")
          .setLabel("Nome completo do clan")
          .setPlaceholder("Exemplo: Alpha Brasil")
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(40)
          .setRequired(true)
      )
    );
}

function joinClanModal() {
  return new ModalBuilder()
    .setCustomId("modal_join_clan")
    .setTitle("Entrar em um clan")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("clan_tag")
          .setLabel("Tag do clan")
          .setPlaceholder("Exemplo: ABC")
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(8)
          .setRequired(true)
      )
    );
}

function modalField(customId, label, value, maxLength, style = TextInputStyle.Short) {
  return new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setValue(value)
      .setStyle(style)
      .setMaxLength(maxLength)
      .setRequired(true)
  );
}

function editPanelModal(panel) {
  return new ModalBuilder()
    .setCustomId("modal_edit_panel")
    .setTitle("Editar painel de acesso")
    .addComponents(
      modalField("panel_title", "Titulo", panel.title, 80),
      modalField("panel_description", "Mensagem principal", panel.description, 500, TextInputStyle.Paragraph),
      modalField("panel_create_label", "Texto do botao de criar", panel.createLabel, 80),
      modalField("panel_join_label", "Texto do botao de entrar", panel.joinLabel, 80),
      modalField("panel_color", "Cor em HEX", panel.accentColor, 7)
    );
}

async function ensurePublicChat(guild) {
  if (publicChatId) {
    const channel = guild.channels.cache.get(publicChatId) ||
      await guild.channels.fetch(publicChatId).catch(() => null);

    if (channel?.type === ChannelType.GuildText) return channel;

    console.warn(`PUBLIC_CHAT_ID nao aponta para um chat de texto no servidor ${guild.id}.`);
    return null;
  }

  if (!createPublicChat) return null;

  const existing = guild.channels.cache.find(
    (channel) => channel.name === publicChatName && channel.type === ChannelType.GuildText
  );

  if (existing) return existing;

  return guild.channels.create({
    name: publicChatName,
    type: ChannelType.GuildText,
    topic: "Chat publico do servidor"
  });
}

async function grantCommunityRole(member) {
  if (!communityRoleId) {
    throw new Error("COMMUNITY_ROLE_ID nao foi configurado.");
  }

  const role = member.guild.roles.cache.get(communityRoleId) ||
    await member.guild.roles.fetch(communityRoleId).catch(() => null);

  if (!role) {
    throw new Error(`Cargo da comunidade ${communityRoleId} nao foi encontrado.`);
  }

  if (member.roles.cache.has(role.id)) {
    return { role, added: false };
  }

  if (!role.editable) {
    throw new Error("O cargo do bot precisa ficar acima do cargo da comunidade.");
  }

  await member.roles.add(role, "Acesso liberado pelo painel da comunidade");
  return { role, added: true };
}

async function handleCommunityAccess(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const { role, added } = await grantCommunityRole(member);

  if (!added) {
    return interaction.editReply(`Voce ja possui o cargo ${role} e seu acesso esta liberado.`);
  }

  return interaction.editReply(`Acesso liberado! Voce recebeu o cargo ${role}.`);
}

async function ensureAccessChannel(guild) {
  const guildState = getGuildState(guild.id);
  const configured = accessChannelId
    ? guild.channels.cache.get(accessChannelId) ||
      await guild.channels.fetch(accessChannelId).catch(() => null)
    : null;

  if (configured?.type === ChannelType.GuildText) {
    guildState.panel.channelId = configured.id;
    saveState();
    return configured;
  }

  const saved = guildState.panel.channelId
    ? guild.channels.cache.get(guildState.panel.channelId)
    : null;

  if (saved?.type === ChannelType.GuildText) return saved;

  const existing = guild.channels.cache.find(
    (channel) => channel.name === accessChannelName && channel.type === ChannelType.GuildText
  );

  const channel = existing || await guild.channels.create({
    name: accessChannelName,
    type: ChannelType.GuildText,
    topic: "Escolha um clan para liberar seu acesso",
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendMessages]
      }
    ]
  });

  guildState.panel.channelId = channel.id;
  saveState();
  return channel;
}

function componentContainsCustomId(component, customId) {
  const data = typeof component.toJSON === "function" ? component.toJSON() : component;
  if (data.custom_id === customId) return true;
  return Array.isArray(data.components) &&
    data.components.some((child) => componentContainsCustomId(child, customId));
}

async function findExistingBotMessage(channel, predicate, maxMessages = 500) {
  const pinned = await channel.messages.fetchPinned().catch(() => null);
  const pinnedMatch = pinned
    ?.filter(predicate)
    .sort((first, second) => second.createdTimestamp - first.createdTimestamp)
    .first();
  if (pinnedMatch) return pinnedMatch;

  let before;
  let checked = 0;
  while (checked < maxMessages) {
    const limit = Math.min(100, maxMessages - checked);
    const batch = await channel.messages.fetch({ limit, before }).catch(() => null);
    if (!batch || batch.size === 0) break;
    const found = batch
      .filter(predicate)
      .sort((first, second) => second.createdTimestamp - first.createdTimestamp)
      .first();
    if (found) return found;
    checked += batch.size;
    const oldest = batch.sort(
      (first, second) => first.createdTimestamp - second.createdTimestamp
    ).first();
    if (!oldest || oldest.id === before || batch.size < limit) break;
    before = oldest.id;
  }
  return null;
}

function isAccessPanelMessage(message) {
  return message.author.id === client.user.id &&
    message.components.some((component) =>
      componentContainsCustomId(component, "panel_community") ||
      componentContainsCustomId(component, "panel_create_clan")
    );
}

async function findExistingPanelMessage(channel) {
  return findExistingBotMessage(channel, isAccessPanelMessage);
}

async function doPublishPanel(guild) {
  const guildState = getGuildState(guild.id);
  const channel = await ensureAccessChannel(guild);
  const payload = {
    components: [panelComponents(guildState.panel)],
    flags: MessageFlags.IsComponentsV2
  };
  let message = null;

  if (guildState.panel.messageId) {
    message = await channel.messages.fetch(guildState.panel.messageId).catch(() => null);
  }

  if (!message) {
    message = await findExistingPanelMessage(channel);
  }

  if (message) {
    await message.edit(payload);
  } else {
    message = await channel.send(payload);
  }

  guildState.panel.channelId = channel.id;
  guildState.panel.messageId = message.id;
  saveState();
  await message.pin().catch(() => null);
  return { channel, message };
}

async function publishPanel(guild) {
  const running = panelPublishLocks.get(guild.id);
  if (running) return running;

  const publishing = doPublishPanel(guild);
  panelPublishLocks.set(guild.id, publishing);

  try {
    return await publishing;
  } finally {
    if (panelPublishLocks.get(guild.id) === publishing) {
      panelPublishLocks.delete(guild.id);
    }
  }
}

async function ensureRankingChannel(guild) {
  const channel = guild.channels.cache.get(rankingChannelId) ||
    await guild.channels.fetch(rankingChannelId).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(`Canal de ranking ${rankingChannelId} nao foi encontrado.`);
  }

  return channel;
}

function isFixedRankingMessage(message) {
  return message.author.id === client.user.id &&
    message.components.some((component) =>
      componentContainsCustomId(component, "ranking_fixed_refresh")
    );
}

async function doPublishRankingPanel(guild) {
  const guildState = getGuildState(guild.id);
  const channel = await ensureRankingChannel(guild);
  const payload = {
    components: [rankingComponents(guild.id, true)],
    flags: MessageFlags.IsComponentsV2
  };
  let message = guildState.rankingPanel.messageId
    ? await channel.messages.fetch(guildState.rankingPanel.messageId).catch(() => null)
    : null;

  if (!message) {
    message = await findExistingBotMessage(channel, isFixedRankingMessage);
  }

  if (message) await message.edit(payload);
  else message = await channel.send(payload);

  guildState.rankingPanel.channelId = channel.id;
  guildState.rankingPanel.messageId = message.id;
  saveState();
  await message.pin().catch(() => null);
  return { channel, message };
}

async function publishRankingPanel(guild) {
  const running = rankingPanelPublishLocks.get(guild.id);
  if (running) return running;

  const publishing = doPublishRankingPanel(guild);
  rankingPanelPublishLocks.set(guild.id, publishing);

  try {
    return await publishing;
  } finally {
    if (rankingPanelPublishLocks.get(guild.id) === publishing) {
      rankingPanelPublishLocks.delete(guild.id);
    }
  }
}

async function refreshRankingPanel(guild) {
  return publishRankingPanel(guild).catch((error) => {
    console.error(`Nao foi possivel atualizar o ranking no servidor ${guild.id}:`, error);
    return null;
  });
}

async function ensureRankedChannel(guild) {
  const guildState = getGuildState(guild.id);
  let channel = null;

  if (rankedChannelId) {
    channel = guild.channels.cache.get(rankedChannelId) ||
      await guild.channels.fetch(rankedChannelId).catch(() => null);
  }

  if (!channel && guildState.rankedPanel.channelId) {
    channel = guild.channels.cache.get(guildState.rankedPanel.channelId) ||
      await guild.channels.fetch(guildState.rankedPanel.channelId).catch(() => null);
  }

  if (!channel) {
    channel = guild.channels.cache.find(
      (candidate) => candidate.name === rankedChannelName && candidate.type === ChannelType.GuildText
    ) || null;
  }

  if (!channel || channel.type !== ChannelType.GuildText) return null;
  guildState.rankedPanel.channelId = channel.id;
  saveState();
  return channel;
}

function isRankedPanelMessage(message) {
  return message.author.id === client.user.id &&
    message.components.some((component) =>
      componentContainsCustomId(component, "ranked_create")
    );
}

async function doPublishRankedPanel(guild) {
  const guildState = getGuildState(guild.id);
  const channel = await ensureRankedChannel(guild);
  if (!channel) return null;

  const payload = {
    components: [rankedHubComponents(guild.id)],
    flags: MessageFlags.IsComponentsV2
  };
  let message = guildState.rankedPanel.messageId
    ? await channel.messages.fetch(guildState.rankedPanel.messageId).catch(() => null)
    : null;

  if (!message) {
    message = await findExistingBotMessage(channel, isRankedPanelMessage);
  }

  if (message) await message.edit(payload);
  else message = await channel.send(payload);

  guildState.rankedPanel.channelId = channel.id;
  guildState.rankedPanel.messageId = message.id;
  saveState();
  await message.pin().catch(() => null);
  return { channel, message };
}

async function publishRankedPanel(guild) {
  const running = rankedPanelPublishLocks.get(guild.id);
  if (running) return running;

  const publishing = doPublishRankedPanel(guild);
  rankedPanelPublishLocks.set(guild.id, publishing);
  try {
    return await publishing;
  } finally {
    if (rankedPanelPublishLocks.get(guild.id) === publishing) {
      rankedPanelPublishLocks.delete(guild.id);
    }
  }
}

async function refreshRankedPanel(guild) {
  return publishRankedPanel(guild).catch((error) => {
    console.error(`Nao foi possivel atualizar a Central Ranked no servidor ${guild.id}:`, error);
    return null;
  });
}

function isClanGuideMessage(message, clan) {
  if (message.author.id !== client.user.id) return false;

  const isPreviousEmbed = message.embeds.some(
    (embed) => embed.title === `Central do clan ${clan.tag}`
  );
  const isCurrentV2 = message.components.some((component) =>
    componentContainsCustomId(component, `clan_invite_select:${clan.tag}`)
  );
  return isPreviousEmbed || isCurrentV2;
}

async function doEnsureClanGuide(guild, clan) {
  const channel = guild.channels.cache.get(clan.textChannelId) ||
    await guild.channels.fetch(clan.textChannelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return null;

  let message = clan.guideMessageId
    ? await channel.messages.fetch(clan.guideMessageId).catch(() => null)
    : null;

  if (!message) {
    message = await findExistingBotMessage(
      channel,
      (candidate) => isClanGuideMessage(candidate, clan)
    );
  }

  const payload = {
    content: null,
    embeds: [],
    components: [clanGuideComponents(clan, guild.id)],
    flags: MessageFlags.IsComponentsV2
  };

  if (message) {
    try {
      await message.edit(payload);
    } catch (error) {
      await message.delete().catch(() => null);
      message = null;
    }
  }

  if (!message) {
    message = await channel.send({
      components: payload.components,
      flags: MessageFlags.IsComponentsV2
    });
  }

  clan.guideMessageId = message.id;
  saveState();
  await message.pin().catch(() => null);
  return message;
}

async function ensureClanGuide(guild, clan) {
  const lockKey = `${guild.id}:${clan.tag}`;
  const running = clanGuidePublishLocks.get(lockKey);
  if (running) return running;

  const publishing = doEnsureClanGuide(guild, clan);
  clanGuidePublishLocks.set(lockKey, publishing);
  try {
    return await publishing;
  } finally {
    if (clanGuidePublishLocks.get(lockKey) === publishing) {
      clanGuidePublishLocks.delete(lockKey);
    }
  }
}

async function ensureClanCategory(guild) {
  const existing = guild.channels.cache.find(
    (channel) => channel.name === clanCategoryName && channel.type === ChannelType.GuildCategory
  );

  if (existing) return existing;

  return guild.channels.create({ name: clanCategoryName, type: ChannelType.GuildCategory });
}

async function importExistingClans(guild) {
  const guildState = getGuildState(guild.id);
  await guild.members.fetch();
  let imported = 0;

  for (const clanRole of guild.roles.cache.values()) {
    if (!clanRole.name.startsWith("Clan ")) continue;

    const tag = cleanTag(clanRole.name.slice(5));
    if (!tag || guildState.clans[tag]) continue;

    const leaderRole = guild.roles.cache.find((role) => role.name === makeLeaderRoleName(tag));
    const textChannel = guild.channels.cache.find(
      (channel) => channel.name === makeChannelName(tag, "clan") && channel.type === ChannelType.GuildText
    );
    const voiceChannel = guild.channels.cache.find(
      (channel) => channel.name === makeChannelName(tag, "call") && channel.type === ChannelType.GuildVoice
    );
    const leader = leaderRole?.members.first();

    if (!leaderRole || !textChannel || !voiceChannel || !leader) continue;

    guildState.clans[tag] = {
      tag,
      name: tag,
      leaderId: leader.id,
      roleId: clanRole.id,
      leaderRoleId: leaderRole.id,
      textChannelId: textChannel.id,
      voiceChannelId: voiceChannel.id,
      members: [...new Set([...clanRole.members.keys(), leader.id])]
    };
    imported += 1;
  }

  if (imported > 0) {
    saveState();
    console.log(`${imported} clan(s) da versao anterior foram recuperados.`);
  }
}

function clanPermissions(guild, clanRole, leaderRole) {
  const common = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak
  ];

  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: clanRole.id, allow: common },
    {
      id: leaderRole.id,
      allow: common,
      deny: [PermissionFlagsBits.ManageChannels]
    }
  ];
}

async function secureClanChannelPermissions(guild, clan) {
  for (const channelId of [clan.textChannelId, clan.voiceChannelId]) {
    const channel = guild.channels.cache.get(channelId) ||
      await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.permissionOverwrites) continue;

    await channel.permissionOverwrites.edit(
      clan.leaderRoleId,
      {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        Connect: true,
        Speak: true,
        ManageChannels: false
      },
      { reason: `Protecao dos canais do clan ${clan.tag}` }
    ).catch((error) => {
      console.error(`Nao foi possivel proteger o canal ${channel.id} do clan ${clan.tag}:`, error);
    });
  }
}

async function createClan(interaction, rawTag, rawName) {
  const guild = interaction.guild;
  const tag = cleanTag(rawTag);
  const name = rawName.trim();
  const lockKey = `${guild.id}:${tag}`;

  if (!tag || tag.length < 2) {
    return interaction.reply({ content: "A tag precisa ter pelo menos 2 letras ou numeros.", flags: MessageFlags.Ephemeral });
  }

  if (getClan(guild.id, tag) || creatingClans.has(lockKey)) {
    return interaction.reply({
      content: "Esse clan ja existe. Use o botao **Entrar em clan** para pedir acesso.",
      flags: MessageFlags.Ephemeral
    });
  }

  const currentClan = findClanByMember(guild.id, interaction.user.id);
  if (currentClan) {
    return interaction.reply({
      content: `Voce ja faz parte do clan **${currentClan.tag} - ${currentClan.name}**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  creatingClans.add(lockKey);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await grantCommunityRole(interaction.member);
    await ensurePublicChat(guild);
    const category = await ensureClanCategory(guild);
    const clanRole = await guild.roles.create({ name: makeClanRoleName(tag), reason: `Cargo do clan ${tag}` });
    const leaderRole = await guild.roles.create({ name: makeLeaderRoleName(tag), reason: `Cargo de lider do clan ${tag}` });
    const permissionOverwrites = clanPermissions(guild, clanRole, leaderRole);

    const textChannel = await guild.channels.create({
      name: makeChannelName(tag, "clan"),
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Chat privado do clan ${tag}`,
      permissionOverwrites
    });
    const voiceChannel = await guild.channels.create({
      name: makeChannelName(tag, "call"),
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites
    });

    await interaction.member.roles.add([clanRole.id, leaderRole.id]);

    const clan = {
      tag,
      name,
      leaderId: interaction.user.id,
      roleId: clanRole.id,
      leaderRoleId: leaderRole.id,
      textChannelId: textChannel.id,
      voiceChannelId: voiceChannel.id,
      members: [interaction.user.id]
    };

    getGuildState(guild.id).clans[tag] = clan;
    saveState();
    await ensureClanGuide(guild, clan).catch((error) => {
      console.error(`Nao foi possivel enviar a orientacao do clan ${tag}:`, error);
      return null;
    });
    await refreshRankingPanel(guild);
    return interaction.editReply({
      components: [clanCreatedComponents(clan, interaction.user, guild.id)],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
  } finally {
    creatingClans.delete(lockKey);
  }
}

async function requestJoin(interaction, rawTag) {
  const tag = cleanTag(rawTag);
  const clan = getClan(interaction.guild.id, tag);

  if (!clan) {
    return interaction.reply({
      content: "Esse clan ainda nao existe. Confira a tag ou use o botao **Criar clan**.",
      flags: MessageFlags.Ephemeral
    });
  }

  const currentClan = findClanByMember(interaction.guild.id, interaction.user.id);
  if (currentClan) {
    return interaction.reply({
      content: `Voce ja faz parte do clan **${currentClan.tag} - ${currentClan.name}**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const existingRequest = Object.values(state.pendingRequests).find(
    (request) => request.guildId === interaction.guild.id && request.requesterId === interaction.user.id
  );
  if (existingRequest) {
    return interaction.reply({ content: "Voce ja possui um pedido aguardando resposta.", flags: MessageFlags.Ephemeral });
  }

  const requestId = `${tag}-${interaction.user.id}-${Date.now()}`;
  state.pendingRequests[requestId] = {
    guildId: interaction.guild.id,
    clanTag: tag,
    requesterId: interaction.user.id
  };
  saveState();

  try {
    const leader = await interaction.guild.members.fetch(clan.leaderId);
    await leader.send({
      components: [requestComponents(clan, interaction.user, requestId)],
      flags: MessageFlags.IsComponentsV2
    });
  } catch (error) {
    delete state.pendingRequests[requestId];
    saveState();
    console.error("Nao foi possivel avisar o lider:", error);
    return interaction.reply({
      content: "Nao consegui enviar o pedido ao lider. Ele precisa permitir mensagens privadas do servidor.",
      flags: MessageFlags.Ephemeral
    });
  }

  return interaction.reply({
    content: "Pedido enviado ao lider do clan. Voce recebera a resposta no privado.",
    flags: MessageFlags.Ephemeral
  });
}

function findClanByLeader(guildId, userId) {
  return getClans(guildId).find((clan) => clan.leaderId === userId);
}

function findClanByMember(guildId, userId) {
  return getClans(guildId).find((clan) => clan.members.includes(userId));
}

async function addMemberToClan(guild, clan, userId) {
  const member = await guild.members.fetch(userId);
  await grantCommunityRole(member);
  await member.roles.add(clan.roleId);
  if (!clan.members.includes(userId)) clan.members.push(userId);
  saveState();
  await ensureClanGuide(guild, clan).catch((error) => {
    console.error(`Nao foi possivel atualizar a central do clan ${clan.tag}:`, error);
  });
  return member;
}

async function handleClanPanel(interaction) {
  const clan = findClanByMember(interaction.guild.id, interaction.user.id);

  if (!clan) {
    return interaction.reply({ content: "Voce ainda nao faz parte de nenhum clan.", flags: MessageFlags.Ephemeral });
  }

  return interaction.reply({
    components: [clanPanelComponents(clan, interaction.guild.id, clan.leaderId === interaction.user.id)],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  });
}

async function handleInvite(interaction, selectedClan = null, selectedTarget = null) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const clan = selectedClan || findClanByLeader(interaction.guild.id, interaction.user.id);
  const target = selectedTarget || interaction.options.getUser("usuario", true);

  if (!clan) {
    return interaction.editReply("Apenas o lider pode convidar membros para o clan.");
  }
  if (target.bot) {
    return interaction.editReply("Bots nao podem entrar em clans.");
  }
  if (target.id === interaction.user.id) {
    return interaction.editReply("Voce ja e o lider desse clan.");
  }

  const currentMember = await interaction.guild.members
    .fetch({ user: target.id, force: true })
    .catch(() => null);
  if (!currentMember) {
    return interaction.editReply("Essa pessoa nao esta mais no servidor. Escolha outro membro.");
  }

  const targetClan = findClanByMember(interaction.guild.id, target.id);
  if (targetClan) {
    return interaction.editReply(
      targetClan.tag === clan.tag
        ? `${target} ja faz parte do seu clan.`
        : `${target} ja faz parte do clan **${targetClan.tag}**.`
    );
  }

  const existingInvite = Object.values(state.pendingInvites).find(
    (invite) => invite.guildId === interaction.guild.id && invite.invitedId === target.id
  );
  if (existingInvite) {
    return interaction.editReply(`${target} ja possui um convite de clan aguardando resposta.`);
  }

  const inviteId = `${clan.tag}-${target.id}-${Date.now()}`;
  state.pendingInvites[inviteId] = {
    guildId: interaction.guild.id,
    clanTag: clan.tag,
    invitedId: target.id,
    inviterId: interaction.user.id
  };
  saveState();

  try {
    await target.send({
      components: [inviteComponents(clan, interaction.user, inviteId)],
      flags: MessageFlags.IsComponentsV2
    });
  } catch (error) {
    delete state.pendingInvites[inviteId];
    saveState();
    if (error.code === 50007 || error.code === 50278) {
      console.warn(`Convite privado recusado pelo Discord para ${target.id} (codigo ${error.code}).`);
    } else {
      console.error("Nao foi possivel enviar o convite do clan:", error);
    }
    const unavailable = error.code === 50278
      ? `${target} nao esta mais neste servidor ou nao compartilha outro servidor com o bot.`
      : `${target} precisa liberar mensagens privadas deste servidor.`;
    return interaction.editReply(`Nao consegui enviar o convite. ${unavailable}`);
  }

  return interaction.editReply(`Convite enviado para ${target}. O acesso sera liberado quando a pessoa aceitar.`);
}

async function handleInviteSelect(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const tag = interaction.customId.split(":")[1];
  const clan = getClan(interaction.guild.id, tag);

  if (!clan || clan.leaderId !== interaction.user.id) {
    return interaction.editReply("Somente o lider desse clan pode usar o seletor de convites.");
  }

  const targetMember = await interaction.guild.members
    .fetch({ user: interaction.values[0], force: true })
    .catch(() => null);
  if (!targetMember) {
    return interaction.editReply("Essa pessoa nao esta mais no servidor. Escolha outro membro.");
  }

  return await handleInvite(interaction, clan, targetMember.user);
}

async function handleAdd(interaction) {
  const clan = findClanByLeader(interaction.guild.id, interaction.user.id);
  const target = interaction.options.getUser("usuario", true);

  if (!clan) {
    return interaction.reply({ content: "Apenas o lider do clan pode adicionar membros.", flags: MessageFlags.Ephemeral });
  }

  const targetClan = findClanByMember(interaction.guild.id, target.id);
  if (target.bot || targetClan) {
    return interaction.reply({
      content: target.bot
        ? "Bots nao podem entrar em clans."
        : `${target} ja faz parte do clan **${targetClan.tag}**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const member = await addMemberToClan(interaction.guild, clan, target.id);
  await member.send(`Voce foi adicionado ao clan **${clan.tag} - ${clan.name}**.`).catch(() => null);
  return interaction.reply({ content: `${target} foi adicionado ao clan ${clan.tag}.`, flags: MessageFlags.Ephemeral });
}

async function handleRemove(interaction) {
  const clan = findClanByLeader(interaction.guild.id, interaction.user.id);
  const target = interaction.options.getUser("usuario", true);

  if (!clan) {
    return interaction.reply({ content: "Apenas o lider do clan pode remover membros.", flags: MessageFlags.Ephemeral });
  }
  if (target.id === clan.leaderId) {
    return interaction.reply({ content: "O lider nao pode remover ele mesmo por aqui.", flags: MessageFlags.Ephemeral });
  }

  const member = await interaction.guild.members.fetch(target.id);
  await member.roles.remove(clan.roleId);
  clan.members = clan.members.filter((id) => id !== target.id);
  saveState();
  await ensureClanGuide(interaction.guild, clan).catch((error) => {
    console.error(`Nao foi possivel atualizar a central do clan ${clan.tag}:`, error);
  });
  return interaction.reply({ content: `${target} foi removido do clan ${clan.tag}.`, flags: MessageFlags.Ephemeral });
}

async function handleUndoClanCommand(interaction) {
  const requestedTag = interaction.options.getString("tag");
  let clan = null;

  if (requestedTag) {
    if (!isPanelAdmin(interaction)) {
      return interaction.reply({
        content: "Somente a staff pode desfazer um clan informando a tag.",
        flags: MessageFlags.Ephemeral
      });
    }
    clan = getClan(interaction.guild.id, requestedTag);
  } else {
    clan = findClanByLeader(interaction.guild.id, interaction.user.id);
  }

  if (!clan) {
    const description = requestedTag
      ? `Nenhum clan foi encontrado com a tag **${cleanTag(requestedTag)}**.`
      : "Voce nao lidera um clan. Se for staff, informe a tag no comando.";
    return interaction.reply({ content: description, flags: MessageFlags.Ephemeral });
  }

  return interaction.reply({
    components: [undoClanWarningComponents(clan, interaction.guild.id, interaction.user.id)],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  });
}

function hasConfiguredAdminRole(interaction) {
  const memberRoles = interaction.member?.roles?.cache;
  return memberRoles
    ? [...adminRoleIds].some((roleId) => memberRoles.has(roleId))
    : false;
}

function isPanelAdmin(interaction) {
  return hasConfiguredAdminRole(interaction) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function cxcClans(guildId, match) {
  return {
    challenger: getClan(guildId, match.challengerTag),
    challenged: getClan(guildId, match.challengedTag)
  };
}

function isCxcLeader(guildId, match, userId) {
  const { challenger, challenged } = cxcClans(guildId, match);
  return Boolean(
    challenger &&
    challenged &&
    [challenger.leaderId, challenged.leaderId].includes(userId)
  );
}

function parseCxcInvitation(interaction) {
  const [action, id, challengerTag, challengedTag, mode, playersValue, bestOfValue] =
    interaction.customId.split(":");
  let match = getCxcMatch(interaction.guild.id, id);

  if (!match) {
    const challenger = getClan(interaction.guild.id, challengerTag);
    const challenged = getClan(interaction.guild.id, challengedTag);
    const players = Number.parseInt(playersValue, 10);
    const bestOf = Number.parseInt(bestOfValue, 10);
    if (!challenger || !challenged || !cxcModeLabels[mode] ||
        !Number.isInteger(players) || players < 1 || players > 20 ||
        ![1, 3, 5].includes(bestOf)) {
      return { action, match: null };
    }

    match = {
      id,
      guildId: interaction.guild.id,
      challengerTag: challenger.tag,
      challengedTag: challenged.tag,
      mode,
      players,
      bestOf,
      points: cxcWinPoints,
      status: "PENDING",
      createdBy: challenger.leaderId,
      createdAt: interaction.message.createdAt.toISOString(),
      expiresAt: new Date(interaction.message.createdTimestamp + cxcInvitationLifetime).toISOString(),
      invitationChannelId: interaction.channelId,
      invitationMessageId: interaction.message.id
    };
    getCxcMatches(interaction.guild.id)[id] = match;
    saveState();
  }

  return { action, match };
}

async function ensureCxcCategory(guild) {
  const configured = guild.channels.cache.get(cxcCategoryId) ||
    await guild.channels.fetch(cxcCategoryId).catch(() => null);
  if (configured?.type === ChannelType.GuildCategory) return configured;

  const existing = guild.channels.cache.find(
    (channel) => channel.name === cxcCategoryName && channel.type === ChannelType.GuildCategory
  );
  if (existing) return existing;

  return guild.channels.create({
    name: cxcCategoryName,
    type: ChannelType.GuildCategory,
    reason: "Categoria de confrontos entre clans"
  });
}

function cxcPermissionOverwrites(guild, challenger, challenged) {
  const permissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AddReactions
  ];
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: challenger.leaderId, allow: permissions },
    { id: challenged.leaderId, allow: permissions }
  ];

  for (const roleId of adminRoleIds) {
    if (guild.roles.cache.has(roleId)) {
      overwrites.push({
        id: roleId,
        allow: [...permissions, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages]
      });
    }
  }

  if (guild.members.me) {
    overwrites.push({
      id: guild.members.me.id,
      allow: [...permissions, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages]
    });
  }
  return overwrites;
}

function cxcChannelTopic(match) {
  const metadata = {
    v: 1,
    i: match.id,
    a: match.challengerTag,
    b: match.challengedTag,
    m: match.mode,
    p: match.players,
    d: match.bestOf,
    o: match.points,
    s: match.status,
    c: match.createdAt,
    x: match.acceptedAt,
    w: match.winnerTag,
    l: match.loserTag,
    r: match.reportedBy,
    q: match.proofDeadline,
    cm: match.controlMessageId,
    rm: match.resultMessageId,
    cb: match.confirmedBy,
    ca: match.confirmedAt
  };
  return `CXC|${Buffer.from(JSON.stringify(metadata), "utf8").toString("base64url")}`;
}

function parseCxcChannelTopic(guildId, channel) {
  if (!channel.topic?.startsWith("CXC")) return null;
  let metadata;
  if (channel.topic.startsWith("CXC|")) {
    try {
      metadata = JSON.parse(
        Buffer.from(channel.topic.slice(4), "base64url").toString("utf8")
      );
    } catch {
      return null;
    }
  } else {
    const [, id, challengerTag, challengedTag, mode, playersValue, bestOfValue, pointsValue] =
      channel.topic.split(":");
    metadata = {
      i: id,
      a: challengerTag,
      b: challengedTag,
      m: mode,
      p: Number.parseInt(playersValue, 10),
      d: Number.parseInt(bestOfValue, 10),
      o: Number.parseInt(pointsValue, 10),
      s: "ACTIVE"
    };
  }

  const {
    i: id,
    a: challengerTag,
    b: challengedTag,
    m: mode,
    p: players,
    d: bestOf,
    o: points
  } = metadata;
  const challenger = getClan(guildId, challengerTag);
  const challenged = getClan(guildId, challengedTag);
  if (!id || !challenger || !challenged || !cxcModeLabels[mode] ||
      !Number.isInteger(players) || players < 1 || players > 20 ||
      ![1, 3, 5].includes(bestOf)) {
    return null;
  }

  return {
    id,
    guildId,
    challengerTag: challenger.tag,
    challengedTag: challenged.tag,
    mode,
    players,
    bestOf,
    points: Number.isInteger(points) && points > 0 ? points : cxcWinPoints,
    status: cxcOpenStatuses.has(metadata.s) ||
      ["CONFIRMED", "CANCELLED", "ANNULLED"].includes(metadata.s)
      ? metadata.s
      : "ACTIVE",
    createdBy: challenger.leaderId,
    createdAt: metadata.c || channel.createdAt.toISOString(),
    acceptedAt: metadata.x || channel.createdAt.toISOString(),
    channelId: channel.id,
    winnerTag: metadata.w,
    loserTag: metadata.l,
    reportedBy: metadata.r,
    proofDeadline: metadata.q,
    controlMessageId: metadata.cm,
    resultMessageId: metadata.rm,
    confirmedBy: metadata.cb,
    confirmedAt: metadata.ca
  };
}

async function recoverCxcChannels(guild) {
  let recovered = 0;
  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildText || !channel.topic?.startsWith("CXC")) continue;
    const parsed = parseCxcChannelTopic(guild.id, channel);
    if (!parsed) continue;
    let match = getCxcMatch(guild.id, parsed.id);
    if (!match) {
      getCxcMatches(guild.id)[parsed.id] = parsed;
      match = parsed;
      recovered += 1;
    } else if (match.status === "PENDING" && !match.channelId) {
      Object.assign(match, parsed, { status: parsed.status === "PENDING" ? "ACTIVE" : parsed.status });
      recovered += 1;
    }

    if (!match.controlMessageId) {
      const control = await findExistingBotMessage(
        channel,
        (message) => message.author.id === client.user.id &&
          message.components.some((component) =>
            componentContainsCustomId(component, `cxc_report:${match.id}`)
          ),
        200
      );
      if (control) match.controlMessageId = control.id;
    }
  }
  if (recovered > 0) {
    saveState();
    console.log(`${recovered} confronto(s) CXC foram recuperados pelos canais existentes.`);
  }
}

async function fetchCxcMessage(guild, channelId, messageId) {
  if (!channelId || !messageId) return null;
  const channel = guild.channels.cache.get(channelId) ||
    await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

async function refreshCxcControl(guild, match) {
  const channel = guild.channels.cache.get(match.channelId) ||
    await guild.channels.fetch(match.channelId).catch(() => null);
  if (channel?.type === ChannelType.GuildText) {
    await channel.setTopic(cxcChannelTopic(match)).catch(() => null);
  }
  const message = await fetchCxcMessage(guild, match.channelId, match.controlMessageId);
  if (!message) return null;
  const { challenger, challenged } = cxcClans(guild.id, match);
  if (!challenger || !challenged) return null;
  return message.edit({
    content: null,
    embeds: [],
    components: [cxcControlComponents(match, challenger, challenged)],
    flags: MessageFlags.IsComponentsV2
  }).catch(() => null);
}

async function applyCxcResult(guild, match, winnerTag, recordedBy) {
  const guildState = getGuildState(guild.id);
  const winner = getClan(guild.id, winnerTag);
  const loserTag = winner?.tag === match.challengerTag
    ? match.challengedTag
    : match.challengerTag;
  const loser = getClan(guild.id, loserTag);
  if (!winner || !loser || ![match.challengerTag, match.challengedTag].includes(winner.tag)) {
    throw new Error("O clan vencedor nao pertence a este confronto.");
  }

  const historyId = `cxc-${match.id}`;
  if (guildState.matchHistory.some((entry) => entry.id === historyId)) {
    match.status = "CONFIRMED";
    match.winnerTag = winner.tag;
    match.loserTag = loser.tag;
    match.matchHistoryId = historyId;
    saveState();
    return guildState.ranking[winner.tag];
  }

  const winnerRanking = guildState.ranking[winner.tag] ||= {
    tag: winner.tag,
    name: winner.name,
    points: 0,
    wins: 0,
    losses: 0,
    matches: 0
  };
  const loserRanking = guildState.ranking[loser.tag] ||= {
    tag: loser.tag,
    name: loser.name,
    points: 0,
    wins: 0,
    losses: 0,
    matches: 0
  };

  winnerRanking.name = winner.name;
  winnerRanking.points += match.points;
  winnerRanking.wins += 1;
  winnerRanking.matches += 1;
  loserRanking.name = loser.name;
  loserRanking.losses += 1;
  loserRanking.matches += 1;
  guildState.matchHistory.push({
    id: historyId,
    source: "cxc",
    cxcId: match.id,
    winnerTag: winner.tag,
    loserTag: loser.tag,
    points: match.points,
    recordedBy,
    recordedAt: new Date().toISOString()
  });
  guildState.matchHistory = guildState.matchHistory.slice(-100);
  match.status = "CONFIRMED";
  match.winnerTag = winner.tag;
  match.loserTag = loser.tag;
  match.confirmedBy = recordedBy;
  match.confirmedAt = new Date().toISOString();
  match.matchHistoryId = historyId;
  saveState();
  await refreshRankingPanel(guild);
  await refreshRankedPanel(guild);
  return winnerRanking;
}

function cxcSetupStatusPayload(title, description, color = 0x5865f2) {
  return {
    content: null,
    embeds: [],
    components: [statusComponents(title, description, color)],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  };
}

async function createCxcChallenge(interaction, configuration, acknowledgement = "reply") {
  if (acknowledgement === "update") await interaction.deferUpdate();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const challenger = findClanByLeader(interaction.guild.id, interaction.user.id);
  if (!challenger) {
    return interaction.editReply(cxcSetupStatusPayload(
      "Acesso restrito",
      "Apenas o lider de um clan pode enviar desafios CXC.",
      0xef4444
    ));
  }

  const challengedTag = cleanTag(String(configuration.challengedTag || ""));
  const challenged = getClan(interaction.guild.id, challengedTag);
  const mode = configuration.mode;
  const players = Number(configuration.players);
  const bestOf = Number(configuration.bestOf);
  if (!challenged) {
    return interaction.editReply(cxcSetupStatusPayload(
      "Clan indisponivel",
      `O clan **${challengedTag}** nao foi encontrado.`,
      0xef4444
    ));
  }
  if (challenger.tag === challenged.tag) {
    return interaction.editReply(cxcSetupStatusPayload(
      "Desafio invalido",
      "Voce nao pode desafiar o proprio clan.",
      0xef4444
    ));
  }
  if (!cxcModeLabels[mode] || !Number.isInteger(players) || players < 1 || players > 20 ||
      ![1, 3, 5].includes(bestOf)) {
    return interaction.editReply(cxcSetupStatusPayload(
      "Configuracao invalida",
      "Confira o modo, o formato e a serie escolhidos.",
      0xef4444
    ));
  }
  if (challenger.members.length < players || challenged.members.length < players) {
    return interaction.editReply(cxcSetupStatusPayload(
      "Membros insuficientes",
      `Cada clan precisa ter pelo menos **${players} membros cadastrados** para jogar ${players}v${players}.\n` +
      `**${challenger.tag}:** ${challenger.members.length} | **${challenged.tag}:** ${challenged.members.length}`,
      0xf59e0b
    ));
  }

  const creationLock = `create:${interaction.guild.id}:${challenger.tag}`;
  if (cxcActionLocks.has(creationLock)) {
    return interaction.editReply(cxcSetupStatusPayload(
      "Desafio em processamento",
      "Aguarde o envio que ja esta em andamento.",
      0xf59e0b
    ));
  }
  cxcActionLocks.add(creationLock);

  try {
  const existing = findOpenCxcForClan(interaction.guild.id, challenger.tag) ||
    findOpenCxcForClan(interaction.guild.id, challenged.tag);
  if (existing) {
    return interaction.editReply(cxcSetupStatusPayload(
      "Confronto ja aberto",
      `Um dos clans ja possui um confronto aberto: **${existing.challengerTag} x ${existing.challengedTag}** ` +
      `(${cxcStatusLabel(existing.status)}; ID ${existing.id}).`,
      0xf59e0b
    ));
  }

  const channel = interaction.guild.channels.cache.get(challenged.textChannelId) ||
    await interaction.guild.channels.fetch(challenged.textChannelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    return interaction.editReply(cxcSetupStatusPayload(
      "Chat indisponivel",
      "O chat privado do clan desafiado nao foi encontrado.",
      0xef4444
    ));
  }

  const match = {
    id: makeCxcId(),
    guildId: interaction.guild.id,
    challengerTag: challenger.tag,
    challengedTag: challenged.tag,
    mode,
    players,
    bestOf,
    points: cxcWinPoints,
    status: "PENDING",
    createdBy: interaction.user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + cxcInvitationLifetime).toISOString(),
    invitationChannelId: channel.id
  };
  getCxcMatches(interaction.guild.id)[match.id] = match;
  saveState();

  let invitation;
  try {
    invitation = await channel.send({
      components: [cxcChallengeComponents(match, challenger, challenged)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { users: [challenged.leaderId] }
    });
  } catch (error) {
    delete getCxcMatches(interaction.guild.id)[match.id];
    saveState();
    console.error(`Nao foi possivel publicar o convite CXC ${match.id}:`, error);
    return interaction.editReply(cxcSetupStatusPayload(
      "Falha ao enviar",
      "Nao consegui publicar o convite no chat do clan adversario. Confira as permissoes do bot e tente novamente.",
      0xef4444
    ));
  }

  match.invitationMessageId = invitation.id;
  saveState();
  await refreshRankedPanel(interaction.guild);
  return interaction.editReply(cxcSetupStatusPayload(
    "Desafio enviado",
    `O convite foi publicado em ${channel}. Somente <@${challenged.leaderId}> pode aceitar ou recusar.\n\n**ID:** ${match.id}`,
    0x22c55e
  ));
  } finally {
    cxcActionLocks.delete(creationLock);
  }
}

async function handleCxcChallengeCommand(interaction) {
  return createCxcChallenge(interaction, {
    challengedTag: interaction.options.getString("clan", true),
    mode: interaction.options.getString("modo", true),
    players: interaction.options.getInteger("jogadores", true),
    bestOf: interaction.options.getInteger("melhor_de", true)
  });
}

async function handleCxcPanelCommand(interaction) {
  if (!isPanelAdmin(interaction)) {
    return interaction.reply({
      content: "Apenas a staff pode publicar a Central Ranked.",
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await publishRankedPanel(interaction.guild);
  if (!result) {
    return interaction.editReply(
      `Nao encontrei o canal **#${rankedChannelName}**. Crie esse canal ou configure RANKED_CHANNEL_ID.`
    );
  }
  return interaction.editReply(`Central Ranked publicada ou atualizada em ${result.channel}.`);
}

async function handleRankedCreateButton(interaction) {
  const challenger = findClanByLeader(interaction.guild.id, interaction.user.id);
  if (!challenger) {
    return interaction.reply({
      components: [statusComponents(
        "Acesso restrito",
        "Somente lideres de clan podem criar um desafio oficial.",
        0xef4444
      )],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
  }

  const existing = findOpenCxcForClan(interaction.guild.id, challenger.tag);
  if (existing) {
    return interaction.reply({
      components: [statusComponents(
        "Confronto ja aberto",
        `Seu clan ja participa de **${existing.challengerTag} x ${existing.challengedTag}** (${cxcStatusLabel(existing.status)}; ID ${existing.id}).`,
        0xf59e0b
      )],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
  }

  const opponents = getClans(interaction.guild.id)
    .filter((clan) => clan.tag !== challenger.tag)
    .sort((first, second) => first.tag.localeCompare(second.tag));
  if (opponents.length === 0) {
    return interaction.reply({
      components: [statusComponents(
        "Nenhum adversario",
        "Ainda nao existe outro clan cadastrado para desafiar.",
        0xf59e0b
      )],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
  }

  return interaction.reply({
    components: [cxcSetupClanComponents(opponents, interaction.user.id)],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  });
}

async function handleRankedMatchesButton(interaction) {
  const clan = findClanByMember(interaction.guild.id, interaction.user.id);
  if (!clan) {
    return interaction.reply({
      components: [statusComponents(
        "Nenhum clan encontrado",
        "Entre em um clan para consultar seus confrontos.",
        0xf59e0b
      )],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
  }

  const matches = Object.values(getCxcMatches(interaction.guild.id))
    .filter((match) => [match.challengerTag, match.challengedTag].includes(clan.tag))
    .sort((first, second) =>
      (second.confirmedAt || second.createdAt).localeCompare(first.confirmedAt || first.createdAt)
    );
  return interaction.reply({
    components: [rankedMyMatchesComponents(clan, matches)],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  });
}

async function handleCxcSetupSelect(interaction) {
  const [action, ownerId, challengedTag, mode, playersValue] = interaction.customId.split(":");
  if (interaction.user.id !== ownerId) {
    return interaction.reply({
      content: "Somente quem iniciou esta configuracao pode continuar.",
      flags: MessageFlags.Ephemeral
    });
  }

  const challenger = findClanByLeader(interaction.guild.id, interaction.user.id);
  if (!challenger) {
    return interaction.update(cxcSetupStatusPayload(
      "Lideranca nao encontrada",
      "Voce nao e mais lider de um clan.",
      0xef4444
    ));
  }

  if (action === "cxc_setup_clan") {
    const selectedTag = cleanTag(interaction.values[0]);
    const challenged = getClan(interaction.guild.id, selectedTag);
    if (!challenged || challenged.tag === challenger.tag) {
      return interaction.update(cxcSetupStatusPayload(
        "Clan indisponivel",
        "Escolha outro clan cadastrado.",
        0xef4444
      ));
    }
    return interaction.update({
      content: null,
      embeds: [],
      components: [cxcSetupModeComponents(ownerId, challenged.tag)]
    });
  }

  const challenged = getClan(interaction.guild.id, challengedTag);
  if (!challenged || challenged.tag === challenger.tag) {
    return interaction.update(cxcSetupStatusPayload(
      "Clan indisponivel",
      "O clan adversario nao existe mais.",
      0xef4444
    ));
  }

  if (action === "cxc_setup_mode") {
    const selectedMode = interaction.values[0];
    if (!cxcModeLabels[selectedMode]) {
      return interaction.update(cxcSetupStatusPayload(
        "Modo invalido",
        "Escolha Gapple ou NoDebuff.",
        0xef4444
      ));
    }
    return interaction.update({
      content: null,
      embeds: [],
      components: [cxcSetupPlayersComponents(ownerId, challenged.tag, selectedMode)]
    });
  }

  if (!cxcModeLabels[mode]) {
    return interaction.update(cxcSetupStatusPayload(
      "Modo invalido",
      "Reinicie a criacao do desafio.",
      0xef4444
    ));
  }

  if (action === "cxc_setup_players") {
    const players = Number.parseInt(interaction.values[0], 10);
    if (!Number.isInteger(players) || players < 1 || players > 20) {
      return interaction.update(cxcSetupStatusPayload(
        "Formato invalido",
        "Escolha um formato entre 1v1 e 20v20.",
        0xef4444
      ));
    }
    return interaction.update({
      content: null,
      embeds: [],
      components: [cxcSetupBestOfComponents(ownerId, challenged.tag, mode, players)]
    });
  }

  if (action === "cxc_setup_bestof") {
    const players = Number.parseInt(playersValue, 10);
    const bestOf = Number.parseInt(interaction.values[0], 10);
    if (!Number.isInteger(players) || players < 1 || players > 20 ||
        ![1, 3, 5].includes(bestOf)) {
      return interaction.update(cxcSetupStatusPayload(
        "Serie invalida",
        "Reinicie a criacao do desafio.",
        0xef4444
      ));
    }
    return interaction.update({
      content: null,
      embeds: [],
      components: [cxcSetupConfirmationComponents(
        challenger,
        challenged,
        mode,
        players,
        bestOf,
        ownerId
      )]
    });
  }
}

async function handleCxcSetupButton(interaction) {
  const [action, ownerId, challengedTag, mode, playersValue, bestOfValue] =
    interaction.customId.split(":");
  if (interaction.user.id !== ownerId) {
    return interaction.reply({
      content: "Somente quem iniciou esta configuracao pode usar este botao.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (action === "cxc_setup_cancel") {
    return interaction.update(cxcSetupStatusPayload(
      "Configuracao cancelada",
      "Nenhum convite foi enviado."
    ));
  }

  return createCxcChallenge(interaction, {
    challengedTag,
    mode,
    players: Number.parseInt(playersValue, 10),
    bestOf: Number.parseInt(bestOfValue, 10)
  }, "update");
}

async function handleCxcConsultCommand(interaction) {
  const clan = findClanByMember(interaction.guild.id, interaction.user.id);
  if (!clan) {
    return interaction.reply({
      content: "Voce precisa fazer parte de um clan para consultar um confronto.",
      flags: MessageFlags.Ephemeral
    });
  }
  const match = findOpenCxcForClan(interaction.guild.id, clan.tag);
  if (!match) {
    return interaction.reply({
      content: "Seu clan nao possui um confronto aberto.",
      flags: MessageFlags.Ephemeral
    });
  }
  return interaction.reply({
    components: [cxcSummaryComponents(match)],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  });
}

async function handleCxcCancelCommand(interaction) {
  const clan = findClanByLeader(interaction.guild.id, interaction.user.id);
  const staff = isPanelAdmin(interaction);
  const requestedId = interaction.options.getString("id")?.trim();

  if (requestedId && !staff) {
    return interaction.reply({
      content: "Somente a staff pode cancelar um confronto pelo ID.",
      flags: MessageFlags.Ephemeral
    });
  }

  let match = requestedId
    ? getCxcMatch(interaction.guild.id, requestedId)
    : null;

  if (!match && staff && !requestedId) {
    match = findCxcByChannel(interaction.guild.id, interaction.channelId);
  }

  if (!match && clan && !requestedId) {
    match = Object.values(getCxcMatches(interaction.guild.id))
      .filter((candidate) =>
        candidate.status === "PENDING" &&
        candidate.challengerTag === clan.tag &&
        candidate.createdBy === interaction.user.id
      )
      .sort((first, second) => second.createdAt.localeCompare(first.createdAt))[0];
  }

  if (!match) {
    return interaction.reply({
      content: staff
        ? "Confronto nao encontrado. Informe o ID exibido no convite: `/cxc cancelar id:ID`."
        : "Apenas o lider desafiante pode cancelar o proprio convite pendente.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (!staff && (
    match.status !== "PENDING" ||
    match.challengerTag !== clan?.tag ||
    match.createdBy !== interaction.user.id
  )) {
    return interaction.reply({
      content: "Apenas o lider desafiante pode cancelar o proprio convite pendente.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (!cxcOpenStatuses.has(match.status)) {
    return interaction.reply({
      content: `Este confronto ja foi encerrado: **${cxcStatusLabel(match.status)}**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (cxcActionLocks.has(match.id)) {
    return interaction.reply({
      content: "Este confronto ja esta sendo atualizado.",
      flags: MessageFlags.Ephemeral
    });
  }

  cxcActionLocks.add(match.id);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    match.status = "CANCELLED";
    match.cancelledBy = interaction.user.id;
    match.cancelledAt = new Date().toISOString();
    saveState();
    await refreshRankedPanel(interaction.guild);

    const cancelledBy = staff
      ? `A staff <@${interaction.user.id}> cancelou este confronto.`
      : `O lider do clan **${match.challengerTag}** cancelou este convite.`;
    const invitation = await fetchCxcMessage(
      interaction.guild,
      match.invitationChannelId,
      match.invitationMessageId
    );
    await invitation?.edit({
      content: null,
      embeds: [],
      components: [cxcClosedInvitationComponents(
        match,
        "Desafio cancelado",
        cancelledBy,
        0xef4444
      )],
      flags: MessageFlags.IsComponentsV2
    }).catch(() => null);
    await refreshCxcControl(interaction.guild, match);

    return interaction.editReply(
      `O confronto **${match.challengerTag} x ${match.challengedTag}** foi cancelado sem alterar o ranking.\n**ID:** ${match.id}`
    );
  } finally {
    cxcActionLocks.delete(match.id);
  }
}

async function handleCxcHistoryCommand(interaction) {
  const requestedTag = interaction.options.getString("clan");
  const ownClan = findClanByMember(interaction.guild.id, interaction.user.id);
  const tag = requestedTag ? cleanTag(requestedTag) : ownClan?.tag;
  if (!tag || !getClan(interaction.guild.id, tag)) {
    return interaction.reply({
      content: "Informe um clan existente ou entre em um clan para consultar o historico.",
      flags: MessageFlags.Ephemeral
    });
  }
  const matches = Object.values(getCxcMatches(interaction.guild.id))
    .filter((match) => [match.challengerTag, match.challengedTag].includes(tag))
    .sort((first, second) => {
      const firstDate = first.confirmedAt || first.createdAt;
      const secondDate = second.confirmedAt || second.createdAt;
      return secondDate.localeCompare(firstDate);
    });
  return interaction.reply({
    components: [cxcHistoryComponents(tag, matches)],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  });
}

async function handleCxcCloseCommand(interaction) {
  if (!isPanelAdmin(interaction)) {
    return interaction.reply({
      content: "Apenas a staff pode encerrar um CXC.",
      flags: MessageFlags.Ephemeral
    });
  }
  const match = findCxcByChannel(interaction.guild.id, interaction.channelId);
  if (!match || !cxcOpenStatuses.has(match.status)) {
    return interaction.reply({
      content: "Este canal nao possui um confronto aberto.",
      flags: MessageFlags.Ephemeral
    });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  match.status = "CANCELLED";
  match.cancelledBy = interaction.user.id;
  match.cancelledAt = new Date().toISOString();
  saveState();
  await refreshRankedPanel(interaction.guild);
  await refreshCxcControl(interaction.guild, match);
  return interaction.editReply(`O confronto **${match.id}** foi encerrado sem alterar o ranking.`);
}

async function handleCxcResolveCommand(interaction) {
  if (!isPanelAdmin(interaction)) {
    return interaction.reply({
      content: "Apenas a staff pode resolver uma contestacao.",
      flags: MessageFlags.Ephemeral
    });
  }
  const match = findCxcByChannel(interaction.guild.id, interaction.channelId);
  if (!match || match.status !== "CONTESTED") {
    return interaction.reply({
      content: "Este canal nao possui um resultado contestado.",
      flags: MessageFlags.Ephemeral
    });
  }
  const winnerTag = cleanTag(interaction.options.getString("vencedora", true));
  if (![match.challengerTag, match.challengedTag].includes(winnerTag)) {
    return interaction.reply({
      content: `A vencedora precisa ser **${match.challengerTag}** ou **${match.challengedTag}**.`,
      flags: MessageFlags.Ephemeral
    });
  }
  if (cxcActionLocks.has(match.id)) {
    return interaction.reply({
      content: "Este confronto ja esta sendo atualizado.",
      flags: MessageFlags.Ephemeral
    });
  }

  cxcActionLocks.add(match.id);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const ranking = await applyCxcResult(interaction.guild, match, winnerTag, interaction.user.id);
    await refreshCxcControl(interaction.guild, match);
    return interaction.editReply(
      `Contestacao resolvida. **${winnerTag}** recebeu **${match.points} pontos** e agora possui **${ranking.points} pontos**.`
    );
  } finally {
    cxcActionLocks.delete(match.id);
  }
}

async function handleCxcAnnulCommand(interaction) {
  if (!isPanelAdmin(interaction)) {
    return interaction.reply({
      content: "Apenas a staff pode anular um CXC.",
      flags: MessageFlags.Ephemeral
    });
  }
  const id = interaction.options.getString("id", true).trim();
  const match = getCxcMatch(interaction.guild.id, id);
  if (!match || match.status !== "CONFIRMED") {
    return interaction.reply({
      content: "Esse ID nao pertence a um CXC confirmado.",
      flags: MessageFlags.Ephemeral
    });
  }
  if (cxcActionLocks.has(match.id)) {
    return interaction.reply({
      content: "Este confronto ja esta sendo atualizado.",
      flags: MessageFlags.Ephemeral
    });
  }

  cxcActionLocks.add(match.id);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const guildState = getGuildState(interaction.guild.id);
    const historyIndex = guildState.matchHistory.findIndex(
      (entry) => entry.id === match.matchHistoryId || entry.id === `cxc-${match.id}`
    );
    if (historyIndex < 0) {
      return interaction.editReply(
        "O registro de ranking desse CXC nao existe mais. Ele pode ter sido removido ou o ranking pode ter sido zerado."
      );
    }

    const [history] = guildState.matchHistory.splice(historyIndex, 1);
    const winnerRanking = guildState.ranking[history.winnerTag];
    const loserRanking = guildState.ranking[history.loserTag];
    if (winnerRanking) {
      winnerRanking.points = Math.max(0, winnerRanking.points - history.points);
      winnerRanking.wins = Math.max(0, winnerRanking.wins - 1);
      winnerRanking.matches = Math.max(0, winnerRanking.matches - 1);
    }
    if (loserRanking) {
      loserRanking.losses = Math.max(0, loserRanking.losses - 1);
      loserRanking.matches = Math.max(0, loserRanking.matches - 1);
    }
    match.status = "ANNULLED";
    match.annulledBy = interaction.user.id;
    match.annulledAt = new Date().toISOString();
    saveState();
    await refreshRankingPanel(interaction.guild);
    await refreshRankedPanel(interaction.guild);
    await refreshCxcControl(interaction.guild, match);
    return interaction.editReply(
      `O CXC **${match.id}** foi anulado e o resultado **${history.winnerTag} x ${history.loserTag}** foi retirado do ranking.`
    );
  } finally {
    cxcActionLocks.delete(match.id);
  }
}

async function handleCxcCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "painel") return handleCxcPanelCommand(interaction);
  if (subcommand === "desafiar") return handleCxcChallengeCommand(interaction);
  if (subcommand === "consultar") return handleCxcConsultCommand(interaction);
  if (subcommand === "cancelar") return handleCxcCancelCommand(interaction);
  if (subcommand === "prova") return handleCxcProofCommand(interaction);
  if (subcommand === "historico") return handleCxcHistoryCommand(interaction);
  if (subcommand === "encerrar") return handleCxcCloseCommand(interaction);
  if (subcommand === "resolver") return handleCxcResolveCommand(interaction);
  if (subcommand === "anular") return handleCxcAnnulCommand(interaction);
}

async function handleRanking(interaction, ephemeral = false) {
  const flags = MessageFlags.IsComponentsV2 |
    (ephemeral ? MessageFlags.Ephemeral : 0);
  return interaction.reply({
    components: [rankingComponents(interaction.guild.id)],
    flags
  });
}

async function handleFixedRankingRefresh(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await refreshRankingPanel(interaction.guild);
  return interaction.editReply(
    result ? `Ranking atualizado em ${result.channel}.` : "Nao foi possivel atualizar o painel agora."
  );
}

async function handleRemovePointsCommand(interaction) {
  if (!isPanelAdmin(interaction)) {
    return interaction.reply({
      content: "Apenas a staff pode retirar resultados do ranking.",
      flags: MessageFlags.Ephemeral
    });
  }

  const winnerTag = cleanTag(interaction.options.getString("vencedora", true));
  const loserTag = cleanTag(interaction.options.getString("perdedora", true));
  if (winnerTag === loserTag) {
    return interaction.reply({
      content: "A vencedora e a perdedora precisam ser clans diferentes.",
      flags: MessageFlags.Ephemeral
    });
  }

  const winner = getClan(interaction.guild.id, winnerTag);
  const loser = getClan(interaction.guild.id, loserTag);
  if (!winner || !loser) {
    return interaction.reply({
      content: "Um dos clans informados nao esta cadastrado. Confira as tags.",
      flags: MessageFlags.Ephemeral
    });
  }

  const history = getGuildState(interaction.guild.id).matchHistory;
  const match = [...history].reverse().find(
    (entry) => entry.winnerTag === winner.tag && entry.loserTag === loser.tag
  );
  if (!match) {
    return interaction.reply({
      content: `Nao existe resultado registrado em que **${winner.tag}** venceu **${loser.tag}**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  return interaction.reply({
    components: [removeResultWarningComponents(match, winner, loser, interaction.guild.id, interaction.user.id)],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  });
}

async function handleRemoveResultButton(interaction) {
  const [action, guildId, matchId, requestedBy] = interaction.customId.split(":");
  if (interaction.user.id !== requestedBy || !isPanelAdmin(interaction)) {
    return interaction.reply({
      content: "Somente o staff que iniciou a retirada pode confirmar.",
      flags: MessageFlags.Ephemeral
    });
  }
  if (interaction.guild.id !== guildId) {
    return interaction.reply({ content: "Essa retirada pertence a outro servidor.", flags: MessageFlags.Ephemeral });
  }
  if (action === "rank_remove_no") {
    return interaction.update({
      content: null,
      embeds: [],
      components: [statusComponents("Retirada cancelada", "O ranking nao foi alterado.", 0x5865f2)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  const guildState = getGuildState(guildId);
  const matchIndex = guildState.matchHistory.findIndex((entry) => entry.id === matchId);
  if (matchIndex === -1) {
    return interaction.update({
      content: null,
      embeds: [],
      components: [statusComponents("Resultado indisponivel", "Esta partida ja foi retirada ou o ranking foi zerado.", 0xf59e0b)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  await interaction.deferUpdate();
  const match = guildState.matchHistory[matchIndex];
  const winnerRanking = guildState.ranking[match.winnerTag];
  const loserRanking = guildState.ranking[match.loserTag];
  if (winnerRanking) {
    winnerRanking.points = Math.max(0, winnerRanking.points - match.points);
    winnerRanking.wins = Math.max(0, winnerRanking.wins - 1);
    winnerRanking.matches = Math.max(0, winnerRanking.matches - 1);
  }
  if (loserRanking) {
    loserRanking.losses = Math.max(0, loserRanking.losses - 1);
    loserRanking.matches = Math.max(0, loserRanking.matches - 1);
  }
  guildState.matchHistory.splice(matchIndex, 1);
  const cxcMatch = match.source === "cxc" && match.cxcId
    ? getCxcMatch(guildId, match.cxcId)
    : null;
  if (cxcMatch?.status === "CONFIRMED") {
    cxcMatch.status = "ANNULLED";
    cxcMatch.annulledBy = interaction.user.id;
    cxcMatch.annulledAt = new Date().toISOString();
  }
  saveState();
  await refreshRankingPanel(interaction.guild);
  if (cxcMatch) await refreshCxcControl(interaction.guild, cxcMatch);

  return interaction.editReply({
    content: null,
    embeds: [],
    components: [statusComponents(
      "Resultado retirado",
      `A partida **${match.winnerTag} x ${match.loserTag}** foi desfeita. Os **${match.points} pontos**, a vitoria e a derrota foram retirados.`,
      0x22c55e
    )],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  });
}

async function handleResetPointsCommand(interaction) {
  if (!isPanelAdmin(interaction)) {
    return interaction.reply({
      content: "Apenas a staff pode zerar o ranking.",
      flags: MessageFlags.Ephemeral
    });
  }

  const matchCount = getGuildState(interaction.guild.id).matchHistory.length;
  return interaction.reply({
    components: [resetRankingWarningComponents(matchCount, interaction.guild.id, interaction.user.id)],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  });
}

async function handleResetPointsButton(interaction) {
  const [action, guildId, requestedBy] = interaction.customId.split(":");
  if (interaction.user.id !== requestedBy || !isPanelAdmin(interaction)) {
    return interaction.reply({
      content: "Somente o staff que iniciou o reset pode confirmar.",
      flags: MessageFlags.Ephemeral
    });
  }
  if (interaction.guild.id !== guildId) {
    return interaction.reply({ content: "Esse reset pertence a outro servidor.", flags: MessageFlags.Ephemeral });
  }
  if (action === "rank_reset_no") {
    return interaction.update({
      content: null,
      embeds: [],
      components: [statusComponents("Reset cancelado", "O ranking nao foi alterado.", 0x5865f2)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  await interaction.deferUpdate();
  const guildState = getGuildState(guildId);
  guildState.ranking = {};
  guildState.matchHistory = [];
  const confirmedCxc = Object.values(guildState.cxc.matches)
    .filter((match) => match.status === "CONFIRMED");
  for (const match of confirmedCxc) {
    match.status = "ANNULLED";
    match.annulledBy = interaction.user.id;
    match.annulledAt = new Date().toISOString();
  }
  saveState();
  await refreshRankingPanel(interaction.guild);
  await Promise.all(confirmedCxc.map((match) => refreshCxcControl(interaction.guild, match)));

  return interaction.editReply({
    content: null,
    embeds: [],
    components: [statusComponents(
      "Ranking zerado",
      "Todos os pontos, vitorias, derrotas e resultados foram removidos. Os clans foram preservados.",
      0x22c55e
    )],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  });
}

async function handleResultCommand(interaction) {
  if (!isPanelAdmin(interaction)) {
    return interaction.reply({
      content: "Apenas a staff pode registrar resultados no ranking.",
      flags: MessageFlags.Ephemeral
    });
  }

  const winnerTag = cleanTag(interaction.options.getString("vencedora", true));
  const loserTag = cleanTag(interaction.options.getString("perdedora", true));
  const points = interaction.options.getInteger("pontos", true);
  const winner = getClan(interaction.guild.id, winnerTag);
  const loser = getClan(interaction.guild.id, loserTag);

  if (!winner || !loser) {
    const missing = [!winner ? winnerTag : null, !loser ? loserTag : null].filter(Boolean).join(", ");
    return interaction.reply({
      content: `Clan(s) nao encontrado(s): **${missing}**. Confira as tags cadastradas.`,
      flags: MessageFlags.Ephemeral
    });
  }
  if (winner.tag === loser.tag) {
    return interaction.reply({
      content: "O clan vencedor e o perdedor precisam ser diferentes.",
      flags: MessageFlags.Ephemeral
    });
  }

  const resultId = interaction.id;
  return interaction.reply({
    components: [resultWarningComponents(
      winner,
      loser,
      points,
      interaction.guild.id,
      interaction.user.id,
      resultId
    )],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  });
}

async function handleResultButton(interaction) {
  const [action, guildId, winnerTag, loserTag, pointsValue, requestedBy, resultId] =
    interaction.customId.split(":");

  if (interaction.user.id !== requestedBy || !isPanelAdmin(interaction)) {
    return interaction.reply({
      content: "Somente o staff que informou o resultado pode confirmar.",
      flags: MessageFlags.Ephemeral
    });
  }
  if (interaction.guild.id !== guildId) {
    return interaction.reply({ content: "Esse resultado pertence a outro servidor.", flags: MessageFlags.Ephemeral });
  }
  if (action === "rank_no") {
    return interaction.update({
      content: null,
      embeds: [],
      components: [statusComponents("Resultado cancelado", "Nenhum ponto foi alterado.", 0x5865f2)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  const guildState = getGuildState(guildId);
  if (guildState.matchHistory.some((match) => match.id === resultId)) {
    return interaction.update({
      content: null,
      embeds: [],
      components: [statusComponents("Resultado ja registrado", "Esta partida nao foi contabilizada novamente.", 0xf59e0b)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  const winner = getClan(guildId, winnerTag);
  const loser = getClan(guildId, loserTag);
  const points = Number.parseInt(pointsValue, 10);
  if (!winner || !loser || !Number.isInteger(points) || points < 1 || points > 100) {
    return interaction.update({
      content: null,
      embeds: [],
      components: [statusComponents("Resultado invalido", "Os clans ou a pontuacao nao estao mais disponiveis.", 0xef4444)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  await interaction.deferUpdate();
  const winnerRanking = guildState.ranking[winner.tag] ||= {
    tag: winner.tag,
    name: winner.name,
    points: 0,
    wins: 0,
    losses: 0,
    matches: 0
  };
  const loserRanking = guildState.ranking[loser.tag] ||= {
    tag: loser.tag,
    name: loser.name,
    points: 0,
    wins: 0,
    losses: 0,
    matches: 0
  };

  winnerRanking.name = winner.name;
  winnerRanking.points += points;
  winnerRanking.wins += 1;
  winnerRanking.matches += 1;
  loserRanking.name = loser.name;
  loserRanking.losses += 1;
  loserRanking.matches += 1;
  guildState.matchHistory.push({
    id: resultId,
    winnerTag: winner.tag,
    loserTag: loser.tag,
    points,
    recordedBy: interaction.user.id,
    recordedAt: new Date().toISOString()
  });
  guildState.matchHistory = guildState.matchHistory.slice(-100);
  saveState();
  await refreshRankingPanel(interaction.guild);

  return interaction.editReply({
    content: null,
    embeds: [],
    components: [statusComponents(
      "Resultado registrado",
      `**${winner.tag}** venceu **${loser.tag}** e recebeu **${points} pontos**.\n\n**Pontuacao atual de ${winner.tag}:** ${winnerRanking.points} pts`,
      0x22c55e
    )],
    flags: MessageFlags.IsComponentsV2
  });
}

async function handlePanelCommand(interaction) {
  if (!isPanelAdmin(interaction)) {
    return interaction.reply({ content: "Apenas administradores podem publicar o painel.", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { channel } = await publishPanel(interaction.guild);
  return interaction.editReply(`Painel publicado e atualizado em ${channel}.`);
}

async function handlePanelEdit(interaction) {
  if (!isPanelAdmin(interaction)) {
    return interaction.reply({ content: "Apenas administradores podem editar o painel.", flags: MessageFlags.Ephemeral });
  }

  return interaction.showModal(editPanelModal(getGuildState(interaction.guild.id).panel));
}

async function handlePanelEditSubmit(interaction) {
  if (!isPanelAdmin(interaction)) {
    return interaction.reply({ content: "Apenas administradores podem editar o painel.", flags: MessageFlags.Ephemeral });
  }

  const color = interaction.fields.getTextInputValue("panel_color").trim();
  if (parseColor(color) === null) {
    return interaction.reply({ content: "A cor precisa estar no formato HEX, por exemplo: `#5865F2`.", flags: MessageFlags.Ephemeral });
  }

  const panel = getGuildState(interaction.guild.id).panel;
  panel.title = interaction.fields.getTextInputValue("panel_title").trim();
  panel.description = interaction.fields.getTextInputValue("panel_description").trim();
  panel.createLabel = interaction.fields.getTextInputValue("panel_create_label").trim();
  panel.joinLabel = interaction.fields.getTextInputValue("panel_join_label").trim();
  panel.accentColor = color.startsWith("#") ? color.toUpperCase() : `#${color.toUpperCase()}`;
  saveState();

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { channel } = await publishPanel(interaction.guild);
  return interaction.editReply(`Painel atualizado com sucesso em ${channel}.`);
}

async function handleApproval(interaction) {
  const [action, requestId] = interaction.customId.split(":");
  const request = state.pendingRequests[requestId];

  if (!request) {
    return interaction.reply({ content: "Esse pedido ja foi resolvido ou expirou.", flags: MessageFlags.Ephemeral });
  }

  const clan = getClan(request.guildId, request.clanTag);
  if (!clan || interaction.user.id !== clan.leaderId) {
    return interaction.reply({ content: "Apenas o lider desse clan pode responder.", flags: MessageFlags.Ephemeral });
  }

  const guild = await client.guilds.fetch(request.guildId);

  if (action === "clan_accept") {
    const member = await addMemberToClan(guild, clan, request.requesterId);
    delete state.pendingRequests[requestId];
    saveState();
    await member.send(
      `Seu pedido foi aprovado. Voce entrou no clan **${clan.tag} - ${clan.name}**. Acesse <#${clan.textChannelId}>.`
    ).catch(() => null);
    return interaction.update({
      content: null,
      embeds: [],
      components: [statusComponents("Pedido aprovado", `${member} agora faz parte do clan **${clan.tag} - ${clan.name}**.`, 0x22c55e)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (action === "clan_deny") {
    const member = await guild.members.fetch(request.requesterId);
    delete state.pendingRequests[requestId];
    saveState();
    await member.send(`Seu pedido para entrar no clan **${clan.tag} - ${clan.name}** foi recusado.`).catch(() => null);
    return interaction.update({
      content: null,
      embeds: [],
      components: [statusComponents("Pedido recusado", `A entrada de ${member} no clan **${clan.tag}** foi recusada.`, 0xef4444)],
      flags: MessageFlags.IsComponentsV2
    });
  }
}

async function handleInviteResponse(interaction) {
  const [action, inviteId] = interaction.customId.split(":");
  const invite = state.pendingInvites[inviteId];

  if (!invite) {
    return interaction.reply({ content: "Esse convite ja foi resolvido ou expirou.", flags: MessageFlags.Ephemeral });
  }
  if (interaction.user.id !== invite.invitedId) {
    return interaction.reply({ content: "Somente a pessoa convidada pode responder.", flags: MessageFlags.Ephemeral });
  }

  const clan = getClan(invite.guildId, invite.clanTag);
  if (!clan) {
    delete state.pendingInvites[inviteId];
    saveState();
    return interaction.update({
      content: null,
      embeds: [],
      components: [statusComponents("Clan indisponivel", "Esse clan nao existe mais.", 0xef4444)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (action === "clan_invite_accept") {
    const currentClan = findClanByMember(invite.guildId, interaction.user.id);
    if (currentClan) {
      delete state.pendingInvites[inviteId];
      saveState();
      return interaction.update({
        content: null,
        embeds: [],
        components: [statusComponents("Convite encerrado", `Voce ja faz parte do clan **${currentClan.tag}**.`, 0xf59e0b)],
        flags: MessageFlags.IsComponentsV2
      });
    }

    const guild = await client.guilds.fetch(invite.guildId);
    const member = await addMemberToClan(guild, clan, invite.invitedId);
    delete state.pendingInvites[inviteId];
    saveState();
    return interaction.update({
      content: null,
      embeds: [],
      components: [statusComponents(
        "Convite aceito",
        `Voce entrou no clan **${clan.tag} - ${clan.name}**. Acesse <#${clan.textChannelId}> ou <#${clan.voiceChannelId}>.`,
        0x22c55e
      )],
      flags: MessageFlags.IsComponentsV2
    });
  }

  if (action === "clan_invite_deny") {
    delete state.pendingInvites[inviteId];
    saveState();
    return interaction.update({
      content: null,
      embeds: [],
      components: [statusComponents("Convite recusado", `O convite do clan **${clan.tag}** foi encerrado.`, 0xef4444)],
      flags: MessageFlags.IsComponentsV2
    });
  }
}

function isAdministrator(interaction) {
  return hasConfiguredAdminRole(interaction) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

async function handleResetClansCommand(interaction) {
  if (!isAdministrator(interaction)) {
    return interaction.reply({ content: "Apenas administradores podem resetar os clans.", flags: MessageFlags.Ephemeral });
  }

  const clans = getClans(interaction.guild.id);
  if (clans.length === 0) {
    return interaction.reply({ content: "Nao existe nenhum clan cadastrado para resetar.", flags: MessageFlags.Ephemeral });
  }

  return interaction.reply({
    components: [resetWarningComponents(clans.length, interaction.guild.id, interaction.user.id)],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  });
}

async function deleteClanResources(guild, clans, reason = "Reset administrativo de clans") {
  let channelsRemoved = 0;
  let rolesRemoved = 0;
  let failures = 0;
  const clanTags = new Set(clans.map((clan) => clan.tag));

  for (const clan of clans) {
    for (const channelId of [clan.textChannelId, clan.voiceChannelId]) {
      const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
      if (!channel) continue;
      await channel.delete(reason)
        .then(() => { channelsRemoved += 1; })
        .catch(() => { failures += 1; });
    }

    for (const roleId of [clan.roleId, clan.leaderRoleId]) {
      const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
      if (!role) continue;
      await role.delete(reason)
        .then(() => { rolesRemoved += 1; })
        .catch(() => { failures += 1; });
    }
  }

  const relatedCxc = Object.values(getCxcMatches(guild.id)).filter((match) =>
    clanTags.has(match.challengerTag) || clanTags.has(match.challengedTag)
  );
  for (const match of relatedCxc) {
    if (match.channelId) {
      const channel = guild.channels.cache.get(match.channelId) ||
        await guild.channels.fetch(match.channelId).catch(() => null);
      if (channel) {
        await channel.delete(reason)
          .then(() => { channelsRemoved += 1; })
          .catch(() => { failures += 1; });
      }
    }
    if (cxcOpenStatuses.has(match.status)) {
      match.status = "CANCELLED";
      match.cancelledAt = new Date().toISOString();
    }
  }

  const category = guild.channels.cache.find(
    (channel) => channel.name === clanCategoryName && channel.type === ChannelType.GuildCategory
  );
  const remainingChildren = category
    ? guild.channels.cache.filter((channel) => channel.parentId === category.id)
    : null;

  if (category && remainingChildren.size === 0) {
    await category.delete(reason)
      .then(() => { channelsRemoved += 1; })
      .catch(() => { failures += 1; });
  }

  const cxcCategory = guild.channels.cache.get(cxcCategoryId) ||
    guild.channels.cache.find(
      (channel) => channel.name === cxcCategoryName && channel.type === ChannelType.GuildCategory
    );
  const remainingCxcChildren = cxcCategory
    ? guild.channels.cache.filter((channel) => channel.parentId === cxcCategory.id)
    : null;
  if (cxcCategory && cxcCategory.id !== cxcCategoryId && remainingCxcChildren.size === 0) {
    await cxcCategory.delete(reason)
      .then(() => { channelsRemoved += 1; })
      .catch(() => { failures += 1; });
  }

  return { channelsRemoved, rolesRemoved, failures };
}

function clearPendingClanActions(guildId) {
  for (const [requestId, request] of Object.entries(state.pendingRequests)) {
    if (request.guildId === guildId) delete state.pendingRequests[requestId];
  }
  for (const [inviteId, invite] of Object.entries(state.pendingInvites)) {
    if (invite.guildId === guildId) delete state.pendingInvites[inviteId];
  }
}

function clearPendingActionsForClan(guildId, tag) {
  for (const [requestId, request] of Object.entries(state.pendingRequests)) {
    if (request.guildId === guildId && request.clanTag === tag) {
      delete state.pendingRequests[requestId];
    }
  }
  for (const [inviteId, invite] of Object.entries(state.pendingInvites)) {
    if (invite.guildId === guildId && invite.clanTag === tag) {
      delete state.pendingInvites[inviteId];
    }
  }
}

async function handleUndoClanButton(interaction) {
  const [action, guildId, tag, requestedBy] = interaction.customId.split(":");

  if (interaction.user.id !== requestedBy) {
    return interaction.reply({
      content: "Somente quem iniciou a exclusao pode confirmar.",
      flags: MessageFlags.Ephemeral
    });
  }
  if (interaction.guild.id !== guildId) {
    return interaction.reply({ content: "Essa confirmacao pertence a outro servidor.", flags: MessageFlags.Ephemeral });
  }

  const clan = getClan(guildId, tag);
  if (!clan) {
    return interaction.update({
      content: null,
      embeds: [],
      components: [statusComponents("Clan indisponivel", "Esse clan ja foi removido.", 0xf59e0b)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  const canDelete = clan.leaderId === interaction.user.id || isPanelAdmin(interaction);
  if (!canDelete) {
    return interaction.reply({
      content: "Apenas o lider desse clan ou a staff pode confirmar a exclusao.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (action === "undo_clan_cancel") {
    return interaction.update({
      content: null,
      embeds: [],
      components: [statusComponents("Exclusao cancelada", `O clan **${clan.tag} - ${clan.name}** nao foi alterado.`, 0x5865f2)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  await interaction.deferUpdate();
  const result = await deleteClanResources(
    interaction.guild,
    [clan],
    `Clan ${clan.tag} desfeito por ${interaction.user.tag}`
  );
  const guildState = getGuildState(guildId);
  delete guildState.clans[clan.tag];
  delete guildState.ranking[clan.tag];
  clearPendingActionsForClan(guildId, clan.tag);
  saveState();
  await refreshRankingPanel(interaction.guild);

  const failureNote = result.failures > 0
    ? `\n**Aviso:** ${result.failures} recurso(s) nao puderam ser removidos.`
    : "\nTodos os recursos foram removidos sem erro.";
  return interaction.editReply({
    content: null,
    embeds: [],
    components: [statusComponents(
      "Clan desfeito",
      `O clan **${clan.tag} - ${clan.name}** foi removido.\n**Cargos:** ${result.rolesRemoved}\n**Canais:** ${result.channelsRemoved}${failureNote}`,
      result.failures > 0 ? 0xf59e0b : 0x22c55e
    )],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  });
}

async function handleResetClansButton(interaction) {
  const [action, guildId, requestedBy] = interaction.customId.split(":");

  if (interaction.user.id !== requestedBy || !isAdministrator(interaction)) {
    return interaction.reply({ content: "Somente o administrador que iniciou o reset pode confirmar.", flags: MessageFlags.Ephemeral });
  }
  if (interaction.guild.id !== guildId) {
    return interaction.reply({ content: "Esse reset pertence a outro servidor.", flags: MessageFlags.Ephemeral });
  }
  if (action === "reset_clans_cancel") {
    return interaction.update({
      content: null,
      embeds: [],
      components: [statusComponents("Reset cancelado", "Nenhum clan foi alterado.", 0x5865f2)],
      flags: MessageFlags.IsComponentsV2
    });
  }

  await interaction.deferUpdate();
  const clans = [...getClans(guildId)];
  const result = await deleteClanResources(interaction.guild, clans);
  const guildState = getGuildState(guildId);
  guildState.clans = {};
  guildState.ranking = {};
  guildState.matchHistory = [];
  guildState.cxc = { matches: {} };
  clearPendingClanActions(guildId);
  saveState();
  await refreshRankingPanel(interaction.guild);

  const failureNote = result.failures > 0
    ? ` ${result.failures} item(ns) nao puderam ser removidos; confira as permissoes e os canais restantes.`
    : "";
  return interaction.editReply({
    content: null,
    embeds: [],
    components: [statusComponents(
      "Reset concluido",
      `**Clans:** ${clans.length}\n**Cargos removidos:** ${result.rolesRemoved}\n**Canais processados:** ${result.channelsRemoved}\n${failureNote || "Todos os recursos foram processados sem erro."}`,
      result.failures > 0 ? 0xf59e0b : 0x22c55e
    )],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  });
}

async function handleCxcInvitationButton(interaction) {
  const { action, match } = parseCxcInvitation(interaction);
  if (!match) {
    return interaction.reply({
      content: "Este convite CXC nao pode mais ser recuperado.",
      flags: MessageFlags.Ephemeral
    });
  }
  const { challenger, challenged } = cxcClans(interaction.guild.id, match);
  if (!challenger || !challenged) {
    return interaction.reply({
      content: "Um dos clans deste confronto nao existe mais.",
      flags: MessageFlags.Ephemeral
    });
  }
  if (interaction.user.id !== challenged.leaderId) {
    return interaction.reply({
      content: `Somente o lider do clan **${challenged.tag}** pode responder.`,
      flags: MessageFlags.Ephemeral
    });
  }
  if (match.status !== "PENDING") {
    return interaction.reply({
      content: `Este convite ja foi encerrado: **${cxcStatusLabel(match.status)}**.`,
      flags: MessageFlags.Ephemeral
    });
  }
  if (cxcActionLocks.has(match.id)) {
    return interaction.reply({
      content: "Este convite ja esta sendo processado.",
      flags: MessageFlags.Ephemeral
    });
  }

  cxcActionLocks.add(match.id);
  await interaction.deferUpdate();
  try {
    if (Date.now() > new Date(match.expiresAt).getTime()) {
      match.status = "CANCELLED";
      match.cancelledAt = new Date().toISOString();
      saveState();
      await refreshRankedPanel(interaction.guild);
      return interaction.editReply({
        content: null,
        embeds: [],
        components: [cxcClosedInvitationComponents(
          match,
          "Convite expirado",
          "Este desafio passou do prazo de 24 horas e foi encerrado.",
          0xf59e0b
        )]
      });
    }

    if (action === "cxc_decline") {
      match.status = "CANCELLED";
      match.cancelledBy = interaction.user.id;
      match.cancelledAt = new Date().toISOString();
      saveState();
      await refreshRankedPanel(interaction.guild);
      return interaction.editReply({
        content: null,
        embeds: [],
        components: [cxcClosedInvitationComponents(
          match,
          "Desafio recusado",
          `O lider do clan **${challenged.tag}** recusou o confronto.`,
          0xef4444
        )]
      });
    }

    const category = await ensureCxcCategory(interaction.guild);
    let channel = null;
    try {
      channel = await interaction.guild.channels.create({
        name: `cxc-${challenger.tag.toLowerCase()}-vs-${challenged.tag.toLowerCase()}-${match.id.slice(-4)}`,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: cxcChannelTopic(match),
        permissionOverwrites: cxcPermissionOverwrites(interaction.guild, challenger, challenged),
        reason: `CXC ${challenger.tag} x ${challenged.tag}`
      });
      match.status = "ACTIVE";
      match.acceptedBy = interaction.user.id;
      match.acceptedAt = new Date().toISOString();
      match.channelId = channel.id;
      const control = await channel.send({
        components: [cxcControlComponents(match, challenger, challenged)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: [challenger.leaderId, challenged.leaderId] }
      });
      match.controlMessageId = control.id;
      await channel.setTopic(cxcChannelTopic(match));
      await control.pin().catch(() => null);
      saveState();
      await refreshRankedPanel(interaction.guild);
    } catch (error) {
      if (channel) await channel.delete("Falha ao preparar o painel do CXC").catch(() => null);
      match.status = "PENDING";
      delete match.acceptedBy;
      delete match.acceptedAt;
      delete match.channelId;
      delete match.controlMessageId;
      saveState();
      throw error;
    }

    return interaction.editReply({
      content: null,
      embeds: [],
      components: [cxcClosedInvitationComponents(
        match,
        "Desafio aceito",
        `O confronto foi aberto em <#${match.channelId}>. Os dois lideres ja possuem acesso.`,
        0x22c55e
      )]
    });
  } finally {
    cxcActionLocks.delete(match.id);
  }
}

async function handleCxcReportButton(interaction) {
  const [, matchId] = interaction.customId.split(":");
  const match = getCxcMatch(interaction.guild.id, matchId);
  if (!match || match.channelId !== interaction.channelId) {
    return interaction.reply({
      content: "Este painel nao pertence a um confronto ativo.",
      flags: MessageFlags.Ephemeral
    });
  }
  if (!isCxcLeader(interaction.guild.id, match, interaction.user.id)) {
    return interaction.reply({
      content: "Somente os dois lideres deste confronto podem informar o vencedor.",
      flags: MessageFlags.Ephemeral
    });
  }
  if (!["ACTIVE", "AWAITING_PROOF"].includes(match.status)) {
    return interaction.reply({
      content: `Nao e possivel informar vencedor com o status **${cxcStatusLabel(match.status)}**.`,
      flags: MessageFlags.Ephemeral
    });
  }
  if (match.status === "AWAITING_PROOF" && match.reportedBy !== interaction.user.id) {
    return interaction.reply({
      content: "O outro lider ja selecionou um vencedor e esta enviando a prova.",
      flags: MessageFlags.Ephemeral
    });
  }
  const { challenger, challenged } = cxcClans(interaction.guild.id, match);
  return interaction.reply({
    components: [cxcWinnerSelectionComponents(match, challenger, challenged)],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  });
}

async function handleCxcWinnerSelect(interaction) {
  const [, matchId] = interaction.customId.split(":");
  const match = getCxcMatch(interaction.guild.id, matchId);
  if (!match || match.channelId !== interaction.channelId) {
    return interaction.reply({
      content: "Este seletor nao pertence a um confronto ativo.",
      flags: MessageFlags.Ephemeral
    });
  }
  if (!isCxcLeader(interaction.guild.id, match, interaction.user.id)) {
    return interaction.reply({
      content: "Somente os lideres podem selecionar o vencedor.",
      flags: MessageFlags.Ephemeral
    });
  }
  if (!["ACTIVE", "AWAITING_PROOF"].includes(match.status)) {
    return interaction.reply({
      content: `O resultado ja esta em outra etapa: **${cxcStatusLabel(match.status)}**.`,
      flags: MessageFlags.Ephemeral
    });
  }
  if (match.status === "AWAITING_PROOF" && match.reportedBy !== interaction.user.id) {
    return interaction.reply({
      content: "O outro lider ja esta enviando uma prova.",
      flags: MessageFlags.Ephemeral
    });
  }

  const winnerTag = cleanTag(interaction.values[0]);
  if (![match.challengerTag, match.challengedTag].includes(winnerTag)) {
    return interaction.reply({
      content: "O clan selecionado nao pertence a este confronto.",
      flags: MessageFlags.Ephemeral
    });
  }

  match.status = "AWAITING_PROOF";
  match.winnerTag = winnerTag;
  match.reportedBy = interaction.user.id;
  match.proofDeadline = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  delete match.proofUrl;
  delete match.resultMessageId;
  saveState();
  await interaction.update({
    content: null,
    embeds: [],
    components: [statusComponents(
      "Vencedor selecionado",
      `Voce selecionou **${winnerTag}**. Use \`/cxc prova imagem:arquivo\` neste canal. O prazo termina <t:${Math.floor(new Date(match.proofDeadline).getTime() / 1000)}:R>.`,
      0xf59e0b
    )]
  });
  await refreshCxcControl(interaction.guild, match);
}

function isProofAttachment(attachment) {
  if (attachment.contentType?.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif)$/i.test(attachment.name || "");
}

async function handleCxcProofCommand(interaction) {
  const match = findCxcByChannel(interaction.guild.id, interaction.channelId);
  if (!match || match.status !== "AWAITING_PROOF") {
    return interaction.reply({
      content: "Este canal nao esta aguardando uma prova.",
      flags: MessageFlags.Ephemeral
    });
  }
  if (match.reportedBy !== interaction.user.id) {
    return interaction.reply({
      content: "Somente o lider que selecionou o vencedor pode enviar esta prova.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (Date.now() > new Date(match.proofDeadline).getTime()) {
    match.status = "ACTIVE";
    delete match.winnerTag;
    delete match.reportedBy;
    delete match.proofDeadline;
    saveState();
    await refreshCxcControl(interaction.guild, match);
    return interaction.reply({
      content: "O prazo da prova expirou. Use **Informar vencedor** novamente.",
      flags: MessageFlags.Ephemeral
    });
  }

  const attachment = interaction.options.getAttachment("imagem", true);
  if (!isProofAttachment(attachment)) {
    return interaction.reply({
      content: "A prova precisa ser uma imagem PNG, JPG, WEBP ou GIF.",
      flags: MessageFlags.Ephemeral
    });
  }
  if (cxcActionLocks.has(match.id)) {
    return interaction.reply({
      content: "Uma prova ja esta sendo processada.",
      flags: MessageFlags.Ephemeral
    });
  }

  cxcActionLocks.add(match.id);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const winner = getClan(interaction.guild.id, match.winnerTag);
    const loser = getClan(
      interaction.guild.id,
      match.winnerTag === match.challengerTag ? match.challengedTag : match.challengerTag
    );
    if (!winner || !loser) {
      return interaction.editReply("Um dos clans nao existe mais. A staff precisa encerrar este confronto.");
    }

    match.proofUrl = attachment.url;
    match.reportedAt = new Date().toISOString();
    const review = await interaction.channel.send({
      components: [cxcResultReviewComponents(match, winner, loser)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: {
        users: [winner.leaderId, loser.leaderId]
      }
    });
    match.status = "RESULT_REPORTED";
    match.proofInteractionId = interaction.id;
    match.resultMessageId = review.id;
    saveState();
    await refreshCxcControl(interaction.guild, match);
    return interaction.editReply("Prova registrada. Agora o outro lider precisa confirmar ou contestar o resultado.");
  } finally {
    cxcActionLocks.delete(match.id);
  }
}

async function handleCxcResultButton(interaction) {
  const [action, matchId] = interaction.customId.split(":");
  const match = getCxcMatch(interaction.guild.id, matchId);
  if (!match || match.channelId !== interaction.channelId) {
    return interaction.reply({
      content: "Este resultado nao pertence a um confronto valido.",
      flags: MessageFlags.Ephemeral
    });
  }
  if (match.status !== "RESULT_REPORTED") {
    return interaction.reply({
      content: `Este resultado ja foi processado: **${cxcStatusLabel(match.status)}**.`,
      flags: MessageFlags.Ephemeral
    });
  }
  if (!isCxcLeader(interaction.guild.id, match, interaction.user.id)) {
    return interaction.reply({
      content: "Somente os lideres deste confronto podem responder.",
      flags: MessageFlags.Ephemeral
    });
  }
  if (interaction.user.id === match.reportedBy) {
    return interaction.reply({
      content: "Quem informou o resultado nao pode confirmar a propria escolha. O outro lider precisa responder.",
      flags: MessageFlags.Ephemeral
    });
  }
  if (cxcActionLocks.has(match.id)) {
    return interaction.reply({
      content: "Este resultado ja esta sendo processado.",
      flags: MessageFlags.Ephemeral
    });
  }

  cxcActionLocks.add(match.id);
  await interaction.deferUpdate();
  try {
    if (action === "cxc_contest") {
      match.status = "CONTESTED";
      match.contestedBy = interaction.user.id;
      match.contestedAt = new Date().toISOString();
      saveState();
      await refreshRankedPanel(interaction.guild);
      await refreshCxcControl(interaction.guild, match);
      return interaction.editReply({
        content: null,
        embeds: [],
        components: [statusComponents(
          "Resultado contestado",
          `O lider <@${interaction.user.id}> contestou a vitoria de **${match.winnerTag}**. Nenhum ponto foi aplicado; a staff deve usar \`/cxc resolver\` neste canal.`,
          0xef4444
        )]
      });
    }

    const ranking = await applyCxcResult(
      interaction.guild,
      match,
      match.winnerTag,
      interaction.user.id
    );
    await refreshCxcControl(interaction.guild, match);
    return interaction.editReply({
      content: null,
      embeds: [],
      components: [statusComponents(
        "Resultado confirmado",
        `**${match.winnerTag}** venceu **${match.loserTag}** e recebeu **${match.points} pontos**.\n\n**Pontuacao atual:** ${ranking.points} pts`,
        0x22c55e
      )]
    });
  } finally {
    cxcActionLocks.delete(match.id);
  }
}

client.once("clientReady", async () => {
  console.log(`Bot online como ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    try {
      await importExistingClans(guild);
      await recoverCxcChannels(guild);
      await ensurePublicChat(guild);
      await publishPanel(guild);
      await publishRankingPanel(guild);
      await publishRankedPanel(guild);
      for (const clan of getClans(guild.id)) {
        await secureClanChannelPermissions(guild, clan);
        await ensureClanGuide(guild, clan);
      }
    } catch (error) {
      console.error(`Nao foi possivel preparar o painel no servidor ${guild.id}:`, error);
    }
  }
});

client.on("guildMemberAdd", async (member) => {
  try {
    const { channel } = await publishPanel(member.guild);
    await member.send(
      `Bem-vindo ao servidor! Acesse ${channel} para entrar na comunidade, criar um clan ou participar de um existente.`
    ).catch(() => null);
  } catch (error) {
    console.error("Nao foi possivel preparar a entrada do novo membro:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "painel") {
      return await handlePanelCommand(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "resetclans") {
      return await handleResetClansCommand(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "ranking") {
      return await handleRanking(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "retirarpontos") {
      return await handleRemovePointsCommand(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "resetarpontos") {
      return await handleResetPointsCommand(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "cxc") {
      return await handleCxcCommand(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "clan") {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "resultado") return await handleResultCommand(interaction);
      if (subcommand === "criar") {
        return await createClan(interaction, interaction.options.getString("tag", true), interaction.options.getString("nome", true));
      }
      if (subcommand === "entrar") return await requestJoin(interaction, interaction.options.getString("tag", true));
      if (subcommand === "painel") return await handleClanPanel(interaction);
      if (subcommand === "convidar") return await handleInvite(interaction);
      if (subcommand === "adicionar") return await handleAdd(interaction);
      if (subcommand === "remover") return await handleRemove(interaction);
      if (subcommand === "desfazer") return await handleUndoClanCommand(interaction);
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith("clan_invite_select:")) {
      return await handleInviteSelect(interaction);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("cxc_winner:")) {
      return await handleCxcWinnerSelect(interaction);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("cxc_setup_")) {
      return await handleCxcSetupSelect(interaction);
    }

    if (interaction.isButton()) {
      if (interaction.customId === "ranked_create") return await handleRankedCreateButton(interaction);
      if (interaction.customId === "ranked_matches") return await handleRankedMatchesButton(interaction);
      if (interaction.customId === "ranked_ranking") return await handleRanking(interaction, true);
      if (interaction.customId.startsWith("cxc_setup_send:") ||
          interaction.customId.startsWith("cxc_setup_cancel:")) {
        return await handleCxcSetupButton(interaction);
      }
      if (interaction.customId.startsWith("cxc_accept:") || interaction.customId.startsWith("cxc_decline:")) {
        return await handleCxcInvitationButton(interaction);
      }
      if (interaction.customId.startsWith("cxc_report:")) {
        return await handleCxcReportButton(interaction);
      }
      if (interaction.customId.startsWith("cxc_confirm:") || interaction.customId.startsWith("cxc_contest:")) {
        return await handleCxcResultButton(interaction);
      }
      if (interaction.customId === "panel_community") return await handleCommunityAccess(interaction);
      if (interaction.customId === "panel_create_clan") return await interaction.showModal(createClanModal());
      if (interaction.customId === "panel_join_clan") return await interaction.showModal(joinClanModal());
      if (interaction.customId === "panel_edit") return await handlePanelEdit(interaction);
      if (interaction.customId === "panel_ranking") return await handleRanking(interaction, true);
      if (interaction.customId === "ranking_fixed_refresh") return await handleFixedRankingRefresh(interaction);
      if (interaction.customId.startsWith("clan_accept:") || interaction.customId.startsWith("clan_deny:")) {
        return await handleApproval(interaction);
      }
      if (interaction.customId.startsWith("clan_invite_accept:") || interaction.customId.startsWith("clan_invite_deny:")) {
        return await handleInviteResponse(interaction);
      }
      if (interaction.customId.startsWith("reset_clans_confirm:") || interaction.customId.startsWith("reset_clans_cancel:")) {
        return await handleResetClansButton(interaction);
      }
      if (interaction.customId.startsWith("undo_clan_confirm:") || interaction.customId.startsWith("undo_clan_cancel:")) {
        return await handleUndoClanButton(interaction);
      }
      if (interaction.customId.startsWith("rank_ok:") || interaction.customId.startsWith("rank_no:")) {
        return await handleResultButton(interaction);
      }
      if (interaction.customId.startsWith("rank_remove_ok:") || interaction.customId.startsWith("rank_remove_no:")) {
        return await handleRemoveResultButton(interaction);
      }
      if (interaction.customId.startsWith("rank_reset_ok:") || interaction.customId.startsWith("rank_reset_no:")) {
        return await handleResetPointsButton(interaction);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "modal_create_clan") {
        return await createClan(
          interaction,
          interaction.fields.getTextInputValue("clan_tag"),
          interaction.fields.getTextInputValue("clan_name")
        );
      }
      if (interaction.customId === "modal_join_clan") {
        return await requestJoin(interaction, interaction.fields.getTextInputValue("clan_tag"));
      }
      if (interaction.customId === "modal_edit_panel") return await handlePanelEditSubmit(interaction);
    }
  } catch (error) {
    console.error(error);
    const content = "Nao foi possivel concluir essa acao. Tente novamente.";
    if (interaction.deferred && !interaction.replied) await interaction.editReply({ content }).catch(() => null);
    else if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }
});

if (require.main === module) {
  const webServer = startWebServer(client);
  let shuttingDown = false;
  let loginTimeout = null;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} recebido. Desligando o bot com seguranca.`);
    if (loginTimeout) clearTimeout(loginTimeout);
    webServer.close();
    client.destroy();
    process.exit(0);
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  loginTimeout = setTimeout(() => {
    if (!client.isReady()) {
      console.error("A conexao com o Discord excedeu 90 segundos. Reiniciando o servico.");
      shutdown("LOGIN_TIMEOUT");
    }
  }, 90_000);
  client.once("clientReady", () => {
    clearTimeout(loginTimeout);
    loginTimeout = null;
  });

  client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error("Nao foi possivel conectar o bot ao Discord:", error);
    shutdown("LOGIN_ERROR");
  });
}

module.exports = {
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
  clanCreatedComponents,
  clanGuideComponents,
  clanPanelComponents,
  clanPermissions,
  inviteComponents,
  panelComponents,
  rankedHubComponents,
  rankedMyMatchesComponents,
  rankingComponents,
  removeResultWarningComponents,
  requestComponents,
  resetRankingWarningComponents,
  resetWarningComponents,
  resultWarningComponents,
  statusComponents,
  undoClanWarningComponents
};
