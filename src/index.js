require("dotenv").config();

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
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder
} = require("discord.js");
const { getGuildState, saveState, state } = require("./store");
const { startWebServer } = require("./web-server");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const creatingClans = new Set();
const panelPublishLocks = new Map();
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
const clanCategoryName = process.env.CLAN_CATEGORY_NAME || "CLANS";

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

function rankingComponents(guildId) {
  const entries = getRankingEntries(guildId);
  const table = entries.length === 0
    ? "Nenhum clan cadastrado no momento."
    : entries.slice(0, 20).map((entry, index) =>
      `**${index + 1}. ${entry.tag}** - ${entry.points} pts\n-# ${entry.wins}V  |  ${entry.losses}D  |  ${entry.matches} partida(s)  |  ${entry.name}`
    ).join("\n\n");

  return new ContainerBuilder()
    .setAccentColor(0xf59e0b)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# Ranking de clans\nClassificacao oficial da comunidade.")
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(table))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("-# Criterios: pontos, vitorias, menos derrotas e ordem alfabetica.")
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
        "## Gerenciamento\n`/clan painel` consulta a equipe.\n`/clan remover usuario:@pessoa` remove um membro.\nPedidos feitos no canal de acesso chegam no privado do lider."
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

function isAccessPanelMessage(message) {
  return message.author.id === client.user.id &&
    message.components.some((component) =>
      componentContainsCustomId(component, "panel_community") ||
      componentContainsCustomId(component, "panel_create_clan")
    );
}

async function findExistingPanelMessage(channel) {
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!recent) return null;

  return recent
    .filter(isAccessPanelMessage)
    .sort((first, second) => second.createdTimestamp - first.createdTimestamp)
    .first() || null;
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

async function ensureClanGuide(guild, clan) {
  const channel = guild.channels.cache.get(clan.textChannelId) ||
    await guild.channels.fetch(clan.textChannelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return null;

  let message = clan.guideMessageId
    ? await channel.messages.fetch(clan.guideMessageId).catch(() => null)
    : null;

  if (!message) {
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    message = recent
      ?.filter((candidate) => isClanGuideMessage(candidate, clan))
      .sort((first, second) => second.createdTimestamp - first.createdTimestamp)
      .first() || null;
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
  return message;
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
    { id: leaderRole.id, allow: [...common, PermissionFlagsBits.ManageChannels] }
  ];
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
    const guideMessage = await textChannel.send({
      components: [clanGuideComponents(clan, guild.id)],
      flags: MessageFlags.IsComponentsV2
    }).catch((error) => {
      console.error(`Nao foi possivel enviar a orientacao do clan ${tag}:`, error);
      return null;
    });
    if (guideMessage) {
      clan.guideMessageId = guideMessage.id;
      saveState();
    }
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
  const clan = selectedClan || findClanByLeader(interaction.guild.id, interaction.user.id);
  const target = selectedTarget || interaction.options.getUser("usuario", true);

  if (!clan) {
    return interaction.reply({ content: "Apenas o lider pode convidar membros para o clan.", flags: MessageFlags.Ephemeral });
  }
  if (target.bot) {
    return interaction.reply({ content: "Bots nao podem entrar em clans.", flags: MessageFlags.Ephemeral });
  }
  if (target.id === interaction.user.id) {
    return interaction.reply({ content: "Voce ja e o lider desse clan.", flags: MessageFlags.Ephemeral });
  }

  const targetClan = findClanByMember(interaction.guild.id, target.id);
  if (targetClan) {
    return interaction.reply({
      content: targetClan.tag === clan.tag
        ? `${target} ja faz parte do seu clan.`
        : `${target} ja faz parte do clan **${targetClan.tag}**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const existingInvite = Object.values(state.pendingInvites).find(
    (invite) => invite.guildId === interaction.guild.id && invite.invitedId === target.id
  );
  if (existingInvite) {
    return interaction.reply({
      content: `${target} ja possui um convite de clan aguardando resposta.`,
      flags: MessageFlags.Ephemeral
    });
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
    console.error("Nao foi possivel enviar o convite do clan:", error);
    return interaction.reply({
      content: `Nao consegui enviar mensagem privada para ${target}. A pessoa precisa liberar mensagens deste servidor.`,
      flags: MessageFlags.Ephemeral
    });
  }

  return interaction.reply({
    content: `Convite enviado para ${target}. O acesso sera liberado quando a pessoa aceitar.`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleInviteSelect(interaction) {
  const tag = interaction.customId.split(":")[1];
  const clan = getClan(interaction.guild.id, tag);

  if (!clan || clan.leaderId !== interaction.user.id) {
    return interaction.reply({
      content: "Somente o lider desse clan pode usar o seletor de convites.",
      flags: MessageFlags.Ephemeral
    });
  }

  const targetMember = await interaction.guild.members.fetch(interaction.values[0]);
  return handleInvite(interaction, clan, targetMember.user);
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

async function handleRanking(interaction, ephemeral = false) {
  const flags = MessageFlags.IsComponentsV2 |
    (ephemeral ? MessageFlags.Ephemeral : 0);
  return interaction.reply({
    components: [rankingComponents(interaction.guild.id)],
    flags
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

  return interaction.update({
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
  clearPendingClanActions(guildId);
  saveState();

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

client.once("clientReady", async () => {
  console.log(`Bot online como ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    try {
      await importExistingClans(guild);
      await ensurePublicChat(guild);
      await publishPanel(guild);
      for (const clan of getClans(guild.id)) {
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
      return handlePanelCommand(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "resetclans") {
      return handleResetClansCommand(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "ranking") {
      return handleRanking(interaction);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "clan") {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "resultado") return handleResultCommand(interaction);
      if (subcommand === "criar") {
        return createClan(interaction, interaction.options.getString("tag", true), interaction.options.getString("nome", true));
      }
      if (subcommand === "entrar") return requestJoin(interaction, interaction.options.getString("tag", true));
      if (subcommand === "painel") return handleClanPanel(interaction);
      if (subcommand === "convidar") return handleInvite(interaction);
      if (subcommand === "adicionar") return handleAdd(interaction);
      if (subcommand === "remover") return handleRemove(interaction);
      if (subcommand === "desfazer") return handleUndoClanCommand(interaction);
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith("clan_invite_select:")) {
      return handleInviteSelect(interaction);
    }

    if (interaction.isButton()) {
      if (interaction.customId === "panel_community") return handleCommunityAccess(interaction);
      if (interaction.customId === "panel_create_clan") return interaction.showModal(createClanModal());
      if (interaction.customId === "panel_join_clan") return interaction.showModal(joinClanModal());
      if (interaction.customId === "panel_edit") return handlePanelEdit(interaction);
      if (interaction.customId === "panel_ranking") return handleRanking(interaction, true);
      if (interaction.customId.startsWith("clan_accept:") || interaction.customId.startsWith("clan_deny:")) {
        return handleApproval(interaction);
      }
      if (interaction.customId.startsWith("clan_invite_accept:") || interaction.customId.startsWith("clan_invite_deny:")) {
        return handleInviteResponse(interaction);
      }
      if (interaction.customId.startsWith("reset_clans_confirm:") || interaction.customId.startsWith("reset_clans_cancel:")) {
        return handleResetClansButton(interaction);
      }
      if (interaction.customId.startsWith("undo_clan_confirm:") || interaction.customId.startsWith("undo_clan_cancel:")) {
        return handleUndoClanButton(interaction);
      }
      if (interaction.customId.startsWith("rank_ok:") || interaction.customId.startsWith("rank_no:")) {
        return handleResultButton(interaction);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "modal_create_clan") {
        return createClan(
          interaction,
          interaction.fields.getTextInputValue("clan_tag"),
          interaction.fields.getTextInputValue("clan_name")
        );
      }
      if (interaction.customId === "modal_join_clan") {
        return requestJoin(interaction, interaction.fields.getTextInputValue("clan_tag"));
      }
      if (interaction.customId === "modal_edit_panel") return handlePanelEditSubmit(interaction);
    }
  } catch (error) {
    console.error(error);
    const message = { content: "Nao foi possivel concluir essa acao. Tente novamente.", flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(message).catch(() => null);
    else await interaction.reply(message).catch(() => null);
  }
});

if (require.main === module) {
  const webServer = startWebServer(client);
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} recebido. Desligando o bot com seguranca.`);
    webServer.close();
    client.destroy();
    process.exit(0);
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error("Nao foi possivel conectar o bot ao Discord:", error);
    shutdown("LOGIN_ERROR");
  });
}

module.exports = {
  clanCreatedComponents,
  clanGuideComponents,
  clanPanelComponents,
  inviteComponents,
  panelComponents,
  rankingComponents,
  requestComponents,
  resetWarningComponents,
  resultWarningComponents,
  statusComponents,
  undoClanWarningComponents
};
