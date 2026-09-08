const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, escapeMarkdown } = require('discord.js');

function standings(q) {
  const players = new Map();
  for (const m of Object.values(q.matches)) {
    if (m.status !== 'FINISHED' || m.size !== 1 || m.players.length !== 2 ||
        m.players[0] === m.players[1] || !m.players.includes(m.winner)) continue;
    for (const id of m.players) {
      const row = players.get(id) || { id, wins: 0, losses: 0 };
      if (id === m.winner) row.wins++; else row.losses++;
      players.set(id, row);
    }
  }
  return [...players.values()].sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.id.localeCompare(b.id));
}

function rankingPanel(q, guild, page = 0, fixed = false) {
  const rows = standings(q);
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  page = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const container = new ContainerBuilder().setAccentColor(0xf1c40f);
  const heading = new TextDisplayBuilder().setContent('**' + escapeMarkdown(guild.name || 'CXC Community') +
    '**\n## Ranking Individual\nGapple / NoDebuff · 1x1');
  const icon = guild.iconURL?.({ extension: 'png', size: 128 });
  if (icon) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(heading)
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(icon).setDescription('Icone do servidor')));
  else container.addTextDisplayComponents(heading);
  const content = rows.slice(page * 10, page * 10 + 10).map((r, index) =>
    '**' + (page * 10 + index + 1) + '.** <@' + r.id + '>\n' +
    '**' + r.wins + ' V** · **' + r.losses + ' D** · ' +
    Math.round(100 * r.wins / (r.wins + r.losses)) + '% de aproveitamento').join('\n\n');
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content || 'Nenhuma partida finalizada.'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    '-# ' + rows.length + ' jogadores · Pagina ' + (page + 1) + '/' + pages +
    '\n-# Mais vitorias, menos derrotas. Ranking exclusivo das filas.'));
  const button = (label, target) => new ButtonBuilder().setCustomId('queue:rank:' + target)
    .setLabel(label).setStyle(ButtonStyle.Secondary);
  const actions = new ActionRowBuilder().addComponents(fixed ? [button('Ver ranking completo', 0)] : [
    button('Anterior', page - 1).setDisabled(page === 0),
    button('Atualizar', page),
    button('Proxima', page + 1).setDisabled(page === pages - 1)]);
  return { flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] }, components: [container, actions] };
}
module.exports = { standings, rankingPanel };
