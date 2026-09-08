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
  const box = { module: { exports: {} }, console, Date, setInterval: fn => { sweep = fn; return { unref() {} }; }, clearInterval() {},
    require: name => name === './store' ? { getGuildState: () => state, saveState: async () => {} } : require(name) };
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
  const client = { user: { id: 'bot' }, isReady: () => true, guilds: { cache: new Map() } };
  const guild = { id: 'guild', client, roles: { cache: new Map() },
    members: { fetch: async id => ({ id }), fetchMe: async () => ({ id: 'bot' }), cache: new Map() },
    channels: { fetch: async id => id ? channels.get(id) : new discord.Collection(channels),
      create: async opts => { created++; const c = channel('match-' + created); c.topic = opts.topic; return c; } } };
  client.guilds.cache.set(guild.id, guild);
  const api = box.module.exports.installQueues(client, i => i.staff, new Set());
  function interaction(user, customId, c = lobby, staff = false) {
    const replies = [];
    return { guild, channel: c, channelId: c.id, customId, user: { id: user }, staff, message: { id: state.queues?.panels[2] },
      deferReply: async () => {}, editReply: async x => { replies.push(x); }, replies };
  }
  return { state, api, interaction, channels, guild, get created() { return created; }, sweep: () => sweep() };
}
test('filas pareiam dois responsaveis, impedem duplicacao e restringem resultado a staff', async () => {
  const s = setup();
  const publish = s.interaction('admin', null, undefined, true); publish.commandName = 'filas';
  await s.api.handle(publish);
  assert.equal(Object.keys(s.state.queues.panels).length, 5);
  await s.api.handle(publish);
  assert.equal(Object.keys(s.state.queues.panels).length, 5);
  await s.api.handle(s.interaction('a', 'queue:join:gapple:2'));
  const b = s.interaction('b', 'queue:join:gapple:2');
  const duplicate = s.interaction('b', 'queue:join:gapple:2');
  await Promise.all([s.api.handle(b), s.api.handle(duplicate)]);
  assert.equal(s.created, 1);
  const m = Object.values(s.state.queues.matches)[0];
  assert.equal(m.players.length, 2);
  assert.equal(m.size, 2);
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
test('criacao interrompida e retomada sem perder os participantes', async () => {
  const s = setup();
  const publish = s.interaction('admin', null, undefined, true); publish.commandName = 'filas';
  await s.api.handle(publish);
  await s.api.handle(s.interaction('a', 'queue:join:nodebuff:2'));
  const create = s.guild.channels.create;
  s.guild.channels.create = async () => { throw new Error('Falha simulada'); };
  await s.api.handle(s.interaction('b', 'queue:join:nodebuff:2'));
  const m = Object.values(s.state.queues.matches)[0];
  assert.equal(m.status, 'CREATING');
  s.guild.channels.create = create;
  await s.sweep();
  assert.equal(m.status, 'ACTIVE');
  assert.equal(s.created, 1);
  assert.equal(m.players.join(','), 'a,b');
});
