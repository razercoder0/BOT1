const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const discord = require('discord.js');
function setup() {
  const state = {};
  let sweep;
  const source = fs.readFileSync(path.join(__dirname, '../src/queues.js'), 'utf8');
  const box = { module: { exports: {} }, console, Date, Buffer, setInterval: fn => { sweep = fn; return { unref() {} }; }, clearInterval() {},
    require: name => name === './store' ? { getGuildState: () => state, saveState: async () => {} } :
      name === './queue-ranking' ? require('../src/queue-ranking') : require(name) };
  vm.runInNewContext(source, box);
  const channels = new Map();
  let created = 0;
  function channel(id) {
    const messages = new Map();
    const c = { id, type: discord.ChannelType.GuildText, parentId: 'category', topic: '',
      send: async payload => { payload.components[0].toJSON(); const m = { id: id + '-' + messages.size, author: { id: 'bot' }, components: payload.components,
        edit: async p => { p.components[0].toJSON(); } }; messages.set(m.id, m); return m; },
      messages: { fetch: async key => typeof key === 'object' ? new discord.Collection(messages) : messages.get(key),
        edit: async (key, p) => { p.components[0].toJSON(); } },
      delete: async () => { channels.delete(id); } };
    channels.set(id, c); return c;
  }
  const lobby = channel('lobby');
  const client = { once() {}, user: { id: 'bot' }, isReady: () => true, guilds: { cache: new Map() } };
  const guild = { id: 'guild', client, roles: { cache: new Map() },
    members: { fetch: async id => ({ id }), fetchMe: async () => ({ id: 'bot' }), cache: new Map() },
    channels: { fetch: async id => id ? channels.get(id) : new discord.Collection(channels),
      create: async opts => { created++; const c = channel('match-' + created); c.topic = opts.topic; return c; } } };
  client.guilds.cache.set(guild.id, guild);
  const api = box.module.exports.installQueues(client, i => i.staff, new Set());
  function interaction(user, customId, c = lobby, staff = false) {
    const replies = [];
    return { guild, channel: c, channelId: c.id, customId, user: { id: user }, staff, message: { id: state.queues?.panels[1] },
      deferReply: async () => {}, editReply: async x => { replies.push(x); }, replies };
  }
  return { state, api, interaction, channels, guild, get created() { return created; }, sweep: () => sweep() };
}
test('filas pareiam dois responsaveis, impedem duplicacao e restringem resultado a staff', async () => {
  const s = setup();
  const publish = s.interaction('admin', null, undefined, true); publish.commandName = 'filas';
  await s.api.handle(publish);
  assert.equal(Object.keys(s.state.queues.panels).length, 1);
  assert.equal(s.state.queues.panels[1], 'lobby-0');
  await s.api.handle(publish);
  assert.equal(s.state.queues.panels[1], 'lobby-0');
  await s.api.handle(s.interaction('a', 'queue:join:gapple:1'));
  const b = s.interaction('b', 'queue:join:gapple:1');
  const duplicate = s.interaction('b', 'queue:join:gapple:1');
  await Promise.all([s.api.handle(b), s.api.handle(duplicate)]);
  assert.equal(s.created, 1);
  const m = Object.values(s.state.queues.matches)[0];
  assert.equal(m.players.length, 2);
  assert.equal(m.size, 1);
  const c = s.channels.get(m.channelId);
  const denied = s.interaction('a', 'queue:result:' + m.id, c);
  await s.api.handle(denied);
  assert.match(denied.replies[0], /Somente a staff/);
  const invalid = s.interaction('other', 'queue:choose:' + m.id + ':admin', c, true);
  invalid.values = ['a']; await s.api.handle(invalid);
  assert.equal(m.status, 'ACTIVE');
  const result = s.interaction('admin', 'queue:choose:' + m.id + ':admin', c, true);
  result.values = ['a']; await s.api.handle(result);
  assert.equal(m.status, 'FINISHED');
  assert.equal(m.winner, 'a');
  m.deleteAt = Date.now() - 1;
  await s.sweep();
  assert.equal(s.channels.has(m.channelId), false);
  assert.ok(m.deletedAt);
});
test('migracao remove formatos antigos sem cancelar partidas', async () => {
  const s = setup();
  const publish = s.interaction('admin', null, undefined, true); publish.commandName = 'filas';
  await s.api.handle(publish);
  const q = s.state.queues;
  const kept = q.panels[1];
  let deleted = 0;
  const lobby = s.channels.get('lobby');
  for (let n = 2; n <= 5; n++) {
    const msg = await lobby.send({ components: [new discord.ContainerBuilder().addTextDisplayComponents(new discord.TextDisplayBuilder().setContent('old'))] });
    msg.delete = async () => { deleted++; };
    q.panels[n] = msg.id;
    q.waiting['gapple:' + n] = 'user-' + n;
  }
  q.waiting['nodebuff:1'] = 'waiting';
  q.matches.legacy = { id: 'legacy', status: 'ACTIVE', size: 5, players: ['x', 'y'] };
  await s.api.handle(publish);
  assert.equal(deleted, 4);
  assert.equal(Object.keys(q.panels).length, 1);
  assert.equal(q.panels[1], kept);
  assert.equal(Object.keys(q.waiting).length, 1);
  assert.equal(q.matches.legacy.status, 'ACTIVE');
  const invalid = s.interaction('z', 'queue:join:gapple:2');
  await s.api.handle(invalid);
  assert.match(invalid.replies[0], /nao esta ativo/);
  await s.api.handle(publish);
  assert.equal(deleted, 4);
});

test('painel individual exige staff, atualiza sem duplicar e preserva ranking de clans', async () => {
  const s = setup();
  s.state.ranking = { CLAN: { points: 42 } };
  const request = staff => {
    const i = s.interaction('admin', null, undefined, staff);
    i.commandName = 'rankfila'; i.options = { getBoolean: () => true }; return i;
  };
  await s.api.handle(request(false));
  assert.equal(s.state.queues.individualPanel, undefined);
  await s.api.handle(request(true));
  const q = s.state.queues;
  const id = q.individualPanel.messageId;
  const msg = await s.channels.get('lobby').messages.fetch(id);
  let edits = 0;
  msg.edit = async p => { p.components.forEach(c => c.toJSON()); edits++; };
  q.matches.done = { status: 'FINISHED', size: 1, players: ['a', 'b'], winner: 'a' };
  await s.sweep();
  assert.equal(edits, 1);
  await s.sweep();
  assert.equal(edits, 1);
  await s.api.handle(request(true));
  assert.equal(q.individualPanel.messageId, id);
  assert.deepEqual(s.state.ranking, { CLAN: { points: 42 } });
});

test('criacao interrompida e retomada sem perder os participantes', async () => {
  const s = setup();
  const publish = s.interaction('admin', null, undefined, true); publish.commandName = 'filas';
  await s.api.handle(publish);
  await s.api.handle(s.interaction('a', 'queue:join:nodebuff:1'));
  const create = s.guild.channels.create;
  s.guild.channels.create = async () => { throw new Error('Falha simulada'); };
  await s.api.handle(s.interaction('b', 'queue:join:nodebuff:1'));
  const m = Object.values(s.state.queues.matches)[0];
  assert.equal(m.status, 'CREATING');
  s.guild.channels.create = create;
  await s.sweep();
  assert.equal(m.status, 'ACTIVE');
  assert.equal(s.created, 1);
  assert.equal(m.players.join(','), 'a,b');
});
test('emergencias exigem staff, confirmacao e preservam partidas ao limpar', async () => {
  const s = setup();
  async function command(action, staff = true, id = null) {
    const i = s.interaction('admin', null, undefined, staff);
    i.commandName = 'fila';
    i.options = { getSubcommand: () => action, getString: () => id, getUser: () => ({ id: 'a' }) };
    await s.api.handle(i); return i;
  }
  const publish = s.interaction('admin', null, undefined, true); publish.commandName = 'filas';
  await s.api.handle(publish);
  await command('pausar', false); assert.ok(!s.state.queues.paused);
  await command('pausar'); assert.equal(s.state.queues.paused, true);
  await s.api.handle(s.interaction('a', 'queue:join:gapple:1'));
  assert.equal(Object.keys(s.state.queues.waiting).length, 0);
  await command('retomar');
  await s.api.handle(s.interaction('a', 'queue:join:gapple:1'));
  await command('remover'); assert.equal(Object.keys(s.state.queues.waiting).length, 0);
  await s.api.handle(s.interaction('a', 'queue:join:gapple:1'));
  await s.api.handle(s.interaction('b', 'queue:join:gapple:1'));
  const m = Object.values(s.state.queues.matches)[0];
  s.state.queues.waiting['gapple:1'] = 'c';
  const clear = await command('limpar');
  const clearId = clear.replies[0].components[0].toJSON().components[1].components[0].custom_id;
  await s.api.handle(s.interaction('other', clearId, undefined, true));
  assert.equal(s.state.queues.waiting['gapple:1'], 'c');
  await s.api.handle(s.interaction('admin', clearId, undefined, true));
  assert.equal(Object.keys(s.state.queues.waiting).length, 0); assert.equal(m.status, 'ACTIVE');
  const list = await command('listar'); assert.ok(list.replies[0].files[0].attachment.toString().includes(m.id));
  const end = await command('encerrar', true, m.id);
  assert.equal(m.status, 'ACTIVE');
  const endId = end.replies[0].components[0].toJSON().components[1].components[0].custom_id;
  await s.api.handle(s.interaction('admin', endId, undefined, true));
  assert.equal(m.status, 'CANCELLED'); assert.equal(m.winner, null);
  await command('reparar'); await s.sweep();
  assert.equal(s.channels.has(m.channelId), false);
});
