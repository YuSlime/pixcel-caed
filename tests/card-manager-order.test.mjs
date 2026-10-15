import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const context = { globalThis: null }; context.globalThis = context;
vm.runInNewContext(fs.readFileSync(new URL('../data/card-manager-state.js', import.meta.url), 'utf8'), context);
const { CardManagerState } = context;
const cards = [{internal_id:'a',card_number:1},{internal_id:'b',card_number:2},{internal_id:'c',card_number:3}];
test('moving parents up and down shifts intervening numbers and undo restores saved order', () => {
  const state = new CardManagerState(); state.setCards(cards);
  state.move('a', 3); assert.deepEqual(Array.from(state.activeCards(), row => [row.internal_id,row.card_number]), [['b',1],['c',2],['a',3]]);
  assert.equal(state.hasChanges(), true); state.discardOrder();
  state.move('c', 1); assert.deepEqual(Array.from(state.activeCards(), row => row.internal_id), ['c','a','b']);
  state.discardOrder(); assert.deepEqual(Array.from(state.activeCards(), row => row.internal_id), ['a','b','c']); assert.equal(state.hasChanges(),false);
});
test('dirty selection and tab guards preserve edits when discard is declined', () => {
  const state = new CardManagerState(); state.setCards(cards); state.dirty = true;
  assert.equal(state.navigate('manage', () => false),false); assert.equal(state.tab,'create');
  assert.equal(state.select('a',null,()=>false),false); assert.equal(state.selectedCard,null);
  assert.equal(state.navigate('manage',()=>true),true); assert.equal(state.hasChanges(),false);
});
