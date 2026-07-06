'use strict';

const assert = require('node:assert/strict');
const Diff = require('../diff-core.js');

function assertRoundTrip(before, after, note) {
  const result = Diff.diffText(before, after);
  assert.equal(Diff.reconstructBefore(result.parts), before, `${note}: before reconstruction`);
  assert.equal(Diff.reconstructAfter(result.parts), after, `${note}: after reconstruction`);
  return result;
}

// Regression: v0.3's shared-token branch advanced only the left pointer.
// This test catches duplicate additions on the right pane.
{
  const before = '様々なイベントを予定しております！';
  const after = '様々なイベントを予定しています！';
  const result = assertRoundTrip(before, after, 'shared token regression');
  assert.ok(result.hunks.length >= 1, 'must produce a hunk');
  assert.equal(Diff.reconstructAfter(result.parts).match(/様々/g).length, 1, 'must not duplicate shared text');
}

{
  assertRoundTrip('浦和レッズは浦和レッズを応援します。', '浦和レッズは浦和レッズを全力で応援します。', 'repeated phrase');
}

{
  assertRoundTrip('1行目\n2行目\n3行目\n', '1行目\n2行目（修正）\n3行目\n', 'line and character diff');
}

{
  assertRoundTrip('https://example.com/?a=1&b=2\n【対象試合】', 'https://example.com/?a=2&b=2\n【対象試合】', 'url change');
}

{
  const before = 'A'.repeat(600) + '共通' + 'B'.repeat(600);
  const after = 'A'.repeat(600) + '共通' + 'C'.repeat(600);
  assertRoundTrip(before, after, 'large single line fallback');
}

console.log('v0.6.0 diff tests: passed');
