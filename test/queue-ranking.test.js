const test = require('node:test');
const assert = require('node:assert/strict');
const { standings, rankingPanel } = require('../src/queue-ranking');

test('ranking individual inclui perdedor, ignora cancelados e equipes', () => {
  const q = { matches: {
    a: { status: 'FINISHED', size: 1, players: ['a', 'b'], winner: 'a' },
    b: { status: 'CANCELLED', size: 1, players: ['b', 'c'], winner: null },
    c: { status: 'FINISHED', size: 2, players: ['c', 'd'], winner: 'c' },
    d: { status: 'ACTIVE', size: 1, players: ['e', 'f'], winner: 'e' }
  } };
  assert.deepEqual(standings(q), [{ id: 'a', wins: 1, losses: 0 }, { id: 'b', wins: 0, losses: 1 }]);
  assert.deepEqual(standings(q), standings(JSON.parse(JSON.stringify(q))));
  assert.equal(standings(q)[0].wins, 1);
});

test('painel individual pagina e serializa com ou sem icone', () => {
  const q = { matches: {} };
  for (let n = 0; n < 15; n++) q.matches[n] = { status: 'FINISHED', size: 1, players: ['winner', 'loser' + n], winner: 'winner' };
  for (const icon of [null, 'https://cdn.discordapp.com/icons/123/icon.png']) {
    const g = { name: 'Comunidade', iconURL: () => icon };
    for (const page of [0, 1, 99]) {
      const p = rankingPanel(q, g, page);
      p.components.forEach(c => c.toJSON());
      assert.ok(JSON.stringify(p.components).length < 10000);
    }
  }
  assert.equal(standings(q).length, 16);
  assert.equal(standings(q)[0].wins, 15);
});
