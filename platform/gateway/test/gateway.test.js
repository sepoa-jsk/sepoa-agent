'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { matchRoute } = require('../server');

test('긴 경로가 먼저 맞는다 — /quote2 는 /quote 에 걸리지 않는다', () => {
  assert.strictEqual(matchRoute('/quote2/api/health').id, 'quote2');
  assert.strictEqual(matchRoute('/quote/api/health').id, 'quote');
});

test('경로 경계를 지킨다 — /quoteX 는 어느 업무에도 맞지 않는다', () => {
  assert.strictEqual(matchRoute('/quoteX/a'), undefined);
});

test('쿼리스트링이 있어도 맞는다', () => {
  assert.strictEqual(matchRoute('/blog?x=1').id, 'blog');
});

test('enabled:false 업무는 라우팅하지 않는다', () => {
  assert.strictEqual(matchRoute('/work/'), undefined);
});
