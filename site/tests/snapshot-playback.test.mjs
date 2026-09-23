// ABOUTME: Regression coverage for replay requests, cancellation and failed snapshots.
// ABOUTME: Run with node --experimental-strip-types --test tests/*.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotLoader } from '../src/lib/snapshotPlayback.ts';

test('late snapshot cannot replace a newer selection', async () => {
  const requests = new Map();
  const loader = createSnapshotLoader('city', 'https://example.test', url => new Promise(resolve => requests.set(url, resolve)));
  const committed = [];
  const first = loader.load(1901, tiles => committed.push(tiles));
  const second = loader.load(1902, tiles => committed.push(tiles));
  requests.get('https://example.test/v1/cities/city/snapshots/1902')({ok:true,json:async()=>({tiles:[2]})});
  await second;
  requests.get('https://example.test/v1/cities/city/snapshots/1901')({ok:true,json:async()=>({tiles:[1]})});
  await first;
  assert.deepEqual(committed, [[2]]);
});
test('return to current state cancels an in-flight replay', async () => {
  let resolve;
  const loader = createSnapshotLoader('city','https://example.test',()=>new Promise(r=>resolve=r));
  let committed = false;
  const request = loader.load(1901,()=>committed=true);
  loader.cancel();
  resolve({ok:true,json:async()=>({tiles:[1]})});
  assert.equal(await request,false);
  assert.equal(committed,false);
});
test('failed or invalid snapshots never replace a working map', async () => {
  for (const response of [{ok:false},{ok:true,json:async()=>({error:'missing'})}]) {
    const loader=createSnapshotLoader('city','https://example.test',async()=>response);
    await assert.rejects(loader.load(1901,()=>assert.fail('must not commit')));
  }
});
