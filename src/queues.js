const { randomUUID } = require('node:crypto');
const { ChannelType, PermissionFlagsBits: P, MessageFlags: F, ContainerBuilder, TextDisplayBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle: B, StringSelectMenuBuilder, SeparatorBuilder } = require('discord.js');
const { getGuildState, saveState } = require('./store');
const modes = { gapple: 'Gapple', nodebuff: 'NoDebuff' };
function state(id) { return getGuildState(id).queues ||= { panels: {}, waiting: {}, matches: {} }; }
function card(title, text, row) {
  const c = new ContainerBuilder().setAccentColor(0x229988)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('## ' + title + '\n' + text));
  if (row) c.addActionRowComponents(row);
  return { flags: F.IsComponentsV2, allowedMentions: { parse: [] }, components: [c] };
}
function btn(id, label, style) { return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style); }
function panel(q, n) {
  const c = new ContainerBuilder().setAccentColor(0xe5b84b)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '-# CXC COMMUNITY  •  DUELS\n## ' + n + ' × ' + n + '  |  ' + (n === 1 ? 'Duelo individual' : 'Duelo de equipes') +
      '\n' + (n === 1 ? 'Dois jogadores. Um confronto.' : 'Duas equipes de ' + n + ' jogadores.')))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  for (const [mode, label] of Object.entries(modes)) {
    const waiting = q.waiting[mode + ':' + n];
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '### ' + (mode === 'gapple' ? '🍎 ' : '🧪 ') + label + '\n' +
      (waiting ? '<@' + waiting + '>\n-# 1/2 responsáveis • Aguardando adversário' : 'Nenhum jogador aguardando\n-# 0/2 responsáveis • Fila disponível')));
  }
  c.addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      btn('queue:join:gapple:' + n, 'Gapple', B.Success).setEmoji('🍎'),
      btn('queue:join:nodebuff:' + n, 'NoDebuff', B.Primary).setEmoji('🧪'),
      btn('queue:leave:' + n, 'Sair', B.Secondary)))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '-# ' + (n === 1 ? 'Vitória registrada pela staff.' : 'Cada responsável leva sua equipe no Minecraft.')));
  return { flags: F.IsComponentsV2, allowedMentions: { parse: [] }, components: [c] };
}
function matchCard(m) {
  const active = m.status === 'ACTIVE';
  return card(active ? 'Partida encontrada' : 'Partida finalizada',
    '**' + modes[m.mode] + ' • ' + m.size + 'x' + m.size + '**\nEquipe 1: <@' + m.players[0] +
    '>\nEquipe 2: <@' + m.players[1] + '>\n\n' +
    (active ? 'Desafiem um ao outro no servidor de Minecraft. Cada responsavel leva sua equipe.\nEnviem a print do resultado aqui. Somente a staff registra a vitoria.' :
      (m.winner ? 'Vencedor: <@' + m.winner + '>\nRegistrado por: <@' + m.staff + '>' : 'Partida cancelada.') + '\nExclusao do canal agendada.'),
    active ? new ActionRowBuilder().addComponents(btn('queue:result:' + m.id, 'Definir vencedor', B.Success),
      btn('queue:cancel:' + m.id, 'Cancelar partida', B.Danger)) : null);
}
function busy(q, id) {
  return Object.values(q.waiting).includes(id) ||
    Object.values(q.matches).some(m => ['CREATING', 'ACTIVE'].includes(m.status) && m.players.includes(id));
}
async function fetchChannel(g, id) {
  try { return await g.channels.fetch(id); }
  catch (e) { if (e.code === 10003) return null; throw e; }
}
function installQueues(client, isStaff, adminRoles) {
  const locks = new Set();
  async function refresh(g) {
    const q = state(g.id);
    if (!q.channelId) return;
    const c = await fetchChannel(g, q.channelId);
    if (!c) return;
    const messages = [];
    for (const id of new Set(Object.values(q.panels))) {
        try { const msg = await c.messages.fetch(id); if (msg) messages.push(msg); }
        catch (e) { if (e.code !== 10008) throw e; }
    }
    messages.sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id, 'en', { numeric: true }));
    // Reuse chronological message slots so existing panels change order without reposting.
    q.panels = {};
    for (let index = 0; index < 5; index++) {
      const n = 5 - index;
      const msg = messages[index];
      if (msg) q.panels[n] = msg.id;
    }
    await saveState();
    for (let n = 5; n >= 1; n--) {
      const msg = messages[5 - n];
      if (msg) await msg.edit(panel(q, n));
      else { q.panels[n] = (await c.send(panel(q, n))).id; await saveState(); }
    }
  }
  client.once('clientReady', async () => {
    for (const g of client.guilds.cache.values()) {
      if (locks.has(g.id)) continue;
      locks.add(g.id);
      try { await refresh(g); }
      catch (e) { console.error('Atualizacao dos paineis de filas:', e); }
      finally { locks.delete(g.id); }
    }
  });
  async function create(g, m) {
    const q = state(g.id);
    const channels = await g.channels.fetch();
    let c = channels.get(m.channelId) || channels.find(c => c?.topic === 'QUEUE|' + m.id);
    if (!c) {
      const me = await g.members.fetchMe();
      const access = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];
      const perms = new Map([[g.id, { id: g.id, deny: [P.ViewChannel] }],
        ...m.players.map(id => [id, { id, allow: access, deny: [P.ManageChannels] }]),
        [me.id, { id: me.id, allow: [...access, P.ManageChannels] }]]);
      for (const role of g.roles.cache.values())
        if (role.id !== g.id && (adminRoles.has(role.id) || role.permissions.has(P.ManageGuild)))
          perms.set(role.id, { id: role.id, allow: access });
      c = await g.channels.create({ name: m.mode + '-' + m.size + 'x' + m.size + '-' + m.id.slice(0, 6),
        type: ChannelType.GuildText, parent: q.categoryId || undefined,
        topic: 'QUEUE|' + m.id, permissionOverwrites: [...perms.values()] });
    }
    m.channelId = c.id; await saveState();
    if (!m.messageId) {
      const recent = await c.messages.fetch({ limit: 100 });
      const msg = recent.find(msg => msg.author.id === client.user.id && msg.components.length);
      m.messageId = msg?.id || (await c.send(matchCard({ ...m, status: 'ACTIVE' }))).id;
    }
    m.status = 'ACTIVE'; await saveState();
  }
  async function handle(i) {
    if (i.commandName !== 'filas' && !i.customId?.startsWith('queue:')) return false;
    if (!i.guild) { await i.reply({ content: 'Use no servidor.', flags: F.Ephemeral }); return true; }
    await i.deferReply({ flags: F.Ephemeral });
    if (locks.has(i.guild.id)) { await i.editReply('Uma acao esta em andamento. Tente novamente em instantes.'); return true; }
    locks.add(i.guild.id);
    try {
      const q = state(i.guild.id);
      if (i.commandName === 'filas') {
        if (!isStaff(i)) throw new Error('Somente a staff publica filas.');
        if (i.channel.type !== ChannelType.GuildText) throw new Error('Use um canal de texto.');
        if (q.channelId && q.channelId !== i.channelId) {
          if (await fetchChannel(i.guild, q.channelId)) throw new Error('Execute /filas em <#' + q.channelId + '>.');
          q.panels = {};
        }
        q.channelId = i.channelId; q.categoryId = i.channel.parentId;
        await saveState(); await refresh(i.guild); await i.editReply('Cinco paineis publicados ou atualizados.'); return true;
      }
      const [, action, arg, value] = i.customId.split(':');
      if (['join', 'leave'].includes(action)) {
        const n = Number(action === 'join' ? value : arg);
        if (![1,2,3,4,5].includes(n) || q.channelId !== i.channelId || q.panels[n] !== i.message.id)
          throw new Error('Este painel nao esta ativo.');
        if (action === 'leave') {
          for (const k of Object.keys(q.waiting))
            if (q.waiting[k] === i.user.id && k.endsWith(':' + n)) delete q.waiting[k];
          await saveState(); await refresh(i.guild); await i.editReply('Voce saiu da fila.'); return true;
        }
        if (!modes[arg]) throw new Error('Modo invalido.');
        if (busy(q, i.user.id)) throw new Error('Voce ja esta em uma fila ou partida.');
        const slot = arg + ':' + n;
        let opponent = q.waiting[slot];
        if (opponent) {
          try { await i.guild.members.fetch(opponent); }
          catch (e) { if (e.code !== 10007) throw e; delete q.waiting[slot]; opponent = null; }
        }
        if (!opponent) {
          q.waiting[slot] = i.user.id; await saveState(); await refresh(i.guild);
          await i.editReply('Voce entrou na fila.'); return true;
        }
        const m = { id: randomUUID(), mode: arg, size: n, players: [opponent, i.user.id],
          status: 'CREATING', createdAt: new Date().toISOString() };
        q.matches[m.id] = m; delete q.waiting[slot]; await saveState();
        await create(i.guild, m); await refresh(i.guild);
        await i.editReply('Partida encontrada: <#' + m.channelId + '>.'); return true;
      }
      if (!isStaff(i)) throw new Error('Somente a staff pode registrar ou cancelar partidas.');
      const m = q.matches[arg];
      if (!m || m.channelId !== i.channelId || m.status !== 'ACTIVE') throw new Error('Partida nao esta ativa.');
      if (action === 'result') {
        const menu = new StringSelectMenuBuilder().setCustomId('queue:choose:' + m.id + ':' + i.user.id)
          .setPlaceholder('Escolher vencedor').addOptions(m.players.map((id, n) => ({
            label: 'Equipe ' + (n + 1), description: i.guild.members.cache.get(id)?.displayName || id, value: id })));
        await i.editReply(card('Registrar resultado', 'Escolha a equipe vencedora.', new ActionRowBuilder().addComponents(menu)));
        return true;
      }
      if (action === 'cancel') {
        await i.editReply(card('Cancelar partida?', 'Confirme o encerramento sem vencedor.',
          new ActionRowBuilder().addComponents(btn('queue:abort:' + m.id + ':' + i.user.id, 'Confirmar cancelamento', B.Danger))));
        return true;
      }
      if (value !== i.user.id || !['choose','abort'].includes(action)) throw new Error('Confirmacao pertence a outro administrador.');
      if (action === 'choose' && !m.players.includes(i.values?.[0])) throw new Error('Vencedor invalido.');
      m.status = action === 'choose' ? 'FINISHED' : 'CANCELLED';
      m.winner = action === 'choose' ? i.values[0] : null;
      m.staff = i.user.id; m.finishedAt = new Date().toISOString(); m.deleteAt = Date.now() + 10000;
      await saveState();
      await i.editReply(card('Partida finalizada', 'Resultado registrado. Canal com exclusao agendada.'));
      await i.channel.messages.edit(m.messageId, matchCard(m));
      return true;
    } catch (e) {
      console.error('Erro nas filas:', e);
      await i.editReply(e.code ? 'Falha no Discord. Verifique as permissoes do bot. A staff pode tentar novamente.' : e.message).catch(() => {});
      return true;
    } finally { locks.delete(i.guild.id); }
  }
  const timer = setInterval(async () => {
    if (!client.isReady()) return;
    for (const g of client.guilds.cache.values()) {
      if (locks.has(g.id)) continue;
      locks.add(g.id);
      try {
        const q = state(g.id);
        for (const m of Object.values(q.matches)) {
          try {
            if (m.status === 'CREATING') { await create(g, m); await refresh(g); }
            if (m.deleteAt && Date.now() >= m.deleteAt && !m.deletedAt) {
              const c = await fetchChannel(g, m.channelId);
              if (c) await c.delete('Partida de fila finalizada');
              m.deletedAt = new Date().toISOString(); await saveState();
            }
          } catch (e) { console.error('Recuperacao da partida de fila:', e); }
        }
      } finally { locks.delete(g.id); }
    }
  }, 10000);
  timer.unref();
  return { handle, stop: () => clearInterval(timer) };
}
module.exports = { installQueues, panel, matchCard, busy };
