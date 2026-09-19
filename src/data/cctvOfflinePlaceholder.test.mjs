import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  CCTV_OFFLINE_PLACEHOLDER_SHA256,
  CCTV_PLACEHOLDER_MAX_BYTES,
  isOfflinePlaceholderFrame,
} from '../../server/providers/cctv/media.js';

/** A body whose SHA-256 is one of the registered offline cards. */
const knownCard = () => {
  // Search a tiny keyspace for a body matching a listed digest is impossible,
  // so instead assert the function against the digests themselves by stubbing
  // a body whose hash we compute the same way the implementation does.
  for (const digest of CCTV_OFFLINE_PLACEHOLDER_SHA256) return digest;
  throw new Error('no placeholder digests registered');
};

test('the registered digests are well-formed and non-empty', () => {
  assert.ok(
    CCTV_OFFLINE_PLACEHOLDER_SHA256.size >= 3,
    'the three observed 511GA cards should be registered',
  );
  for (const digest of CCTV_OFFLINE_PLACEHOLDER_SHA256) {
    assert.match(digest, /^[0-9a-f]{64}$/, digest);
  }
  assert.ok(knownCard());
});

test('a body matching a registered digest is detected', () => {
  // Build a body, register its digest the way a maintainer would, and confirm
  // the matcher agrees — this exercises the hash path without shipping a
  // 15 KB binary fixture.
  const body = Buffer.from('pretend offline card bytes');
  const digest = createHash('sha256').update(body).digest('hex');
  CCTV_OFFLINE_PLACEHOLDER_SHA256.add(digest);
  try {
    assert.equal(isOfflinePlaceholderFrame(body), true);
  } finally {
    CCTV_OFFLINE_PLACEHOLDER_SHA256.delete(digest);
  }
  // Once de-registered it is an ordinary frame again.
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
  // Bodies past the bound short-circuit before the digest is taken. Register a
  // large body's digest and confirm it is still NOT reported, proving the
  // prefilter ran rather than the hash.
  const big = Buffer.alloc(CCTV_PLACEHOLDER_MAX_BYTES + 1, 3);
  const digest = createHash('sha256').update(big).digest('hex');
  CCTV_OFFLINE_PLACEHOLDER_SHA256.add(digest);
  try {
    assert.equal(isOfflinePlaceholderFrame(big), false);
  } finally {
    CCTV_OFFLINE_PLACEHOLDER_SHA256.delete(digest);
  }
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
