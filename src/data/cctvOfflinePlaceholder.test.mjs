import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  CCTV_OFFLINE_PLACEHOLDER_SHA256,
  CCTV_PLACEHOLDER_MAX_BYTES,
  isOfflinePlaceholderFrame,
} from '../../server/providers/cctv/media.js';

/** A one-entry digest set built from `body`, for the injectable-set tests. */
const digestsFor = (body) =>
  new Set([createHash('sha256').update(body).digest('hex')]);

test('the registered digests are well-formed and non-empty', () => {
  assert.ok(
    CCTV_OFFLINE_PLACEHOLDER_SHA256.size >= 3,
    'the three observed 511GA cards should be registered',
  );
  for (const digest of CCTV_OFFLINE_PLACEHOLDER_SHA256) {
    assert.match(digest, /^[0-9a-f]{64}$/, digest);
  }
});

test('a body matching a registered digest is detected', () => {
  // Exercises the hash path against an injected set, so the shared registry is
  // never mutated and the tests cannot leak state into one another.
  const body = Buffer.from('pretend offline card bytes');
  assert.equal(isOfflinePlaceholderFrame(body, digestsFor(body)), true);
  // Against the real registry the same body is an ordinary frame.
  assert.equal(isOfflinePlaceholderFrame(body), false);
});

test('a real frame is never mistaken for a placeholder', () => {
  // Exact-hash matching is the whole point: a dark night frame, a tiny frame,
  // and a large frame all pass through untouched.
  assert.equal(isOfflinePlaceholderFrame(Buffer.alloc(9000)), false);
  assert.equal(isOfflinePlaceholderFrame(Buffer.alloc(120_000, 7)), false);
  assert.equal(
    isOfflinePlaceholderFrame(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    false,
  );
});

test('the size prefilter skips hashing anything frame-sized', () => {
  // A body past the bound short-circuits before the digest is taken: matching
  // it against its OWN digest still reports false, which only the prefilter
  // can produce.
  const big = Buffer.alloc(CCTV_PLACEHOLDER_MAX_BYTES + 1, 3);
  assert.equal(isOfflinePlaceholderFrame(big, digestsFor(big)), false);
  // One byte under the bound, the same construction matches.
  const small = Buffer.alloc(CCTV_PLACEHOLDER_MAX_BYTES - 1, 3);
  assert.equal(isOfflinePlaceholderFrame(small, digestsFor(small)), true);
});

test('the bound sits clear of both the cards and real frames', () => {
  // Observed on 511GA, 2026-09-19: cards 7,574 / 11,955 / 15,136 B; smallest
  // real frame across 60 metro Atlanta cameras 107,257 B.
  assert.ok(CCTV_PLACEHOLDER_MAX_BYTES > 15_136, 'must cover the largest card');
  assert.ok(
    CCTV_PLACEHOLDER_MAX_BYTES < 107_257,
    'must stay below the smallest observed real frame',
  );
});

test('empty and malformed bodies are not placeholders', () => {
  assert.equal(isOfflinePlaceholderFrame(null), false);
  assert.equal(isOfflinePlaceholderFrame(undefined), false);
  assert.equal(isOfflinePlaceholderFrame(Buffer.alloc(0)), false);
  assert.equal(isOfflinePlaceholderFrame('not a buffer'), false);
  assert.equal(isOfflinePlaceholderFrame({}), false);
});
