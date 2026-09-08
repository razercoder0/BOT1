const { randomUUID } = require('node:crypto');
const { ChannelType, PermissionFlagsBits: P, MessageFlags: F, ContainerBuilder, TextDisplayBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle: B, StringSelectMenuBuilder, SectionBuilder, ThumbnailBuilder, escapeMarkdown } = require('discord.js');
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
function panel(q, n, guild) {
  const title = escapeMarkdown(guild?.name || 'CXC Community');
  const players = Object.entries(modes).map(([mode, label]) => {
    const id = q.waiting[mode + ':' + n];
    return label + ': ' + (id ? '<@' + id + '> — aguardando adversário' : 'Nenhum jogador na fila.');
  }).join('\n');
  const text = new TextDisplayBuilder().setContent('**' + title + '**\n\n' +
    '**FORMATO**\n' + n + 'x' + n + (n === 1 ? ' individual' : ' em equipes') + '\n\n' +
    '**MODO**\nGapple / NoDebuff\n\n**JOGADORES**\n' + players);
  const c = new ContainerBuilder().setAccentColor(0xf1c40f);
  const icon = guild?.iconURL?.({ extension: 'png', size: 128 });
  if (icon) c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(text)
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(icon).setDescription('Ícone do servidor')));
  else c.addTextDisplayComponents(text);
  const actions = new ActionRowBuilder().addComponents(
    btn('queue:join:gapple:' + n, 'Gapple', B.Secondary).setDisabled(Boolean(q.paused)),
    btn('queue:join:nodebuff:' + n, 'NoDebuff', B.Secondary).setDisabled(Boolean(q.paused)),
    btn('queue:leave:' + n, 'Sair da fila', B.Danger));
  return { flags: F.IsComponentsV2, allowedMentions: { parse: [] }, components: [c, actions] };
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
      if (msg) await msg.edit(panel(q, n, g));
      else { q.panels[n] = (await c.send(panel(q, n, g))).id; await saveState(); }
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
    if (!['filas', 'fila'].includes(i.commandName) && !i.customId?.startsWith('queue:')) return false;
    if (!i.guild) { await i.reply({ content: 'Use no servidor.', flags: F.Ephemeral }); return true; }
    await i.deferReply({ flags: F.Ephemeral });
    if (locks.has(i.guild.id)) { await i.editReply('Uma acao esta em andamento. Tente novamente em instantes.'); return true; }
    locks.add(i.guild.id);
    try {
      const q = state(i.guild.id);
      if (i.commandName === 'fila' || i.customId?.startsWith('queue:emergency:')) {
        if (!isStaff(i)) throw new Error('Somente a staff pode usar comandos de emergencia.');
        const parts = i.customId?.split(':');
        const action = parts ? parts[2] : i.options.getSubcommand();
        const confirmed = Boolean(parts);
        if (confirmed && (parts[3] !== i.user.id || Date.now() - Number(parts[4]) > 60000 || !Number.isFinite(Number(parts[4]))))
          throw new Error('Confirmacao expirada ou pertence a outro administrador.');
        if (action === 'pausar' || action === 'retomar') {
          q.paused = action === 'pausar'; await saveState(); await refresh(i.guild);
          await i.editReply(q.paused ? 'Novas entradas pausadas.' : 'Novas entradas liberadas.'); return true;
        }
        if (action === 'listar') {
          const matches = Object.values(q.matches).filter(m => !m.deletedAt);
          const lines = matches.map(m => m.id + ' | ' + m.status + ' | ' + modes[m.mode] + ' ' + m.size + 'x' + m.size +
            ' | ' + m.players.map(id => '<@' + id + '>').join(' x ') + (m.channelId ? ' | <#' + m.channelId + '>' : ''));
          await i.editReply({ content: lines.length ? 'Lista completa no arquivo anexado.' : 'Nenhuma partida pendente.',
            files: lines.length ? [{ attachment: Buffer.from(lines.join('\n')), name: 'partidas.txt' }] : [] }); return true;
        }
        if (action === 'remover') {
          const user = i.options.getUser('jogador', true);
          let removed = false;
          for (const key of Object.keys(q.waiting)) if (q.waiting[key] === user.id) { delete q.waiting[key]; removed = true; }
          await saveState(); await refresh(i.guild);
          await i.editReply(removed ? 'Jogador removido da espera.' : 'Jogador nao esta na espera. Para partidas, use /fila encerrar.'); return true;
        }
        if (action === 'limpar' || action === 'encerrar') {
          const id = confirmed ? parts[5] : (action === 'encerrar' ? i.options.getString('id') : null);
          const m = action === 'encerrar' ? (id ? q.matches[id] : Object.values(q.matches).find(m => m.channelId === i.channelId)) : null;
          if (action === 'encerrar' && (!m || !['ACTIVE', 'CREATING'].includes(m.status)))
            throw new Error('Partida nao esta ativa. Use /fila listar para consultar os IDs.');
          if (!confirmed) {
            await i.editReply(card('Confirmar ' + action + '?', action === 'limpar' ? 'Remove todos da espera. Partidas continuam. Valido por 60 segundos.' :
              'Encerra ' + m.id + ' sem vencedor e agenda a exclusao do chat. Valido por 60 segundos.',
              new ActionRowBuilder().addComponents(btn('queue:emergency:' + action + ':' + i.user.id + ':' + Date.now() + ':' + (m?.id || '-'), 'Confirmar', B.Danger)))); return true;
          }
          if (m) {
            // Recover a channel created before its ID was saved, without creating another one.
            if (!m.channelId) {
              const channels = await i.guild.channels.fetch();
              m.channelId = channels.find(c => c?.topic === 'QUEUE|' + m.id)?.id;
            }
            m.status = 'CANCELLED'; m.winner = null; m.staff = i.user.id;
            m.finishedAt = new Date().toISOString(); m.deleteAt = Date.now() + 10000;
          } else q.waiting = {};
          await saveState(); await refresh(i.guild);
          await i.editReply(card('Concluido', m ? 'Partida cancelada sem alterar pontos. Exclusao agendada.' : 'Espera limpa. Partidas preservadas.')); return true;
        }
        if (action === 'reparar') {
          let repaired = 0;
          for (const m of Object.values(q.matches)) {
            if (m.status === 'ACTIVE' && m.channelId && !await fetchChannel(i.guild, m.channelId)) {
              m.status = 'CANCELLED'; m.staff = i.user.id; m.finishedAt = new Date().toISOString();
              m.deletedAt = m.finishedAt; repaired++;
            }
            if (['FINISHED', 'CANCELLED'].includes(m.status) && !m.deletedAt) m.deleteAt = Date.now();
          }
          await saveState(); await refresh(i.guild);
          await i.editReply('Paineis verificados. ' + repaired + ' partida(s) sem canal liberada(s). Exclusoes pendentes serao tentadas novamente.'); return true;
        }
        throw new Error('Acao de emergencia invalida.');
      }
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
        if (q.paused) throw new Error('As filas estao pausadas pela staff.');
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
              const c = m.channelId ? await fetchChannel(g, m.channelId) : null;
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
