import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  atlantaApiKey,
  atlantaCameraToSource,
  isLikelyGeorgiaCoordinate,
  loadAtlantaSourcesFromOpenData,
  normalizeAtlantaCctvUrl,
  pickAtlantaCctvView,
} from '../../server/providers/cctv/sources.js';
import {
  ATLANTA_511_IMAGE_ORIGIN,
  ATLANTA_GROUND_ELEVATION_M,
} from '../../server/providers/cctv/constants.js';

/**
 * One 511GA camera record, shaped like the live `/api/v2/get/cameras` payload:
 * a downtown Atlanta camera on the Downtown Connector with one enabled view.
 */
const row = (overrides = {}) => ({
  Id: 186,
  Source: 'GDOT',
  SourceId: 'gdot-186',
  Roadway: 'I-75/85',
  Direction: 'Northbound',
  Latitude: 33.7537,
  Longitude: -84.3903,
  Location: 'I-75/85 NB at Courtland St',
  SortOrder: 1,
  Name: 'GDOT Camera 186',
  Views: [
    {
      Id: 186,
      Url: 'https://511ga.org/map/Cctv/186',
      Status: 'Enabled',
      Description: 'I-75/85 NB at Courtland St',
      SortId: 1,
    },
  ],
  ...overrides,
});

/** Swap the env key for one test without leaking it into the others. */
const withKey = async (value, fn) => {
  const previous = process.env.CCTV_ATLANTA_KEY;
  if (value === undefined) delete process.env.CCTV_ATLANTA_KEY;
  else process.env.CCTV_ATLANTA_KEY = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.CCTV_ATLANTA_KEY;
    else process.env.CCTV_ATLANTA_KEY = previous;
  }
};

test('a 511GA record maps to a source on the pinned frame host', () => {
  const source = atlantaCameraToSource(row());
  assert.equal(source.id, 'ga-186');
  assert.equal(source.name, 'I-75/85 NB at Courtland St');
  assert.equal(source.city, 'Atlanta');
  assert.equal(source.cityId, 'atlanta');
  assert.equal(source.provider, 'Georgia DOT 511');
  assert.equal(source.lat, 33.7537);
  assert.equal(source.lon, -84.3903);
  assert.equal(source.feedType, 'image');
  assert.equal(source.sourceKind, 'ga-511-open-data');
  assert.equal(source.groundElevationM, ATLANTA_GROUND_ELEVATION_M);
  assert.equal(source.url, 'https://511ga.org/map/Cctv/186');
  assert.equal(source.url, source.snapshotUrl);
  assert.ok(source.url.startsWith(ATLANTA_511_IMAGE_ORIGIN));
});

test('the dedicated Direction field earns the high-confidence pose', () => {
  // Unlike Austin, 511GA publishes a real facing per camera. That is the whole
  // reason this pack gets the -24/56/210 personality instead of the
  // headingless one.
  const north = atlantaCameraToSource(row());
  assert.equal(north.headingDeg, 0);
  assert.equal(north.headingConfidence, 'high');
  assert.equal(north.pitchDeg, -24);
  assert.equal(north.fovDeg, 56);
  assert.equal(north.rangeM, 210);
  assert.equal(north.mountHeightM, 10);

  for (const [direction, heading] of [
    ['Southbound', 180],
    ['Eastbound', 90],
    ['Westbound', 270],
    ['North', 0],
    ['West', 270],
  ]) {
    const source = atlantaCameraToSource(row({ Direction: direction }));
    assert.equal(source.headingDeg, heading, direction);
    assert.equal(source.headingConfidence, 'high', direction);
  }
});

test('a directionless camera falls back to the view text, then to the id hash', () => {
  const fromView = atlantaCameraToSource(
    row({
      Direction: '',
      Views: [
        {
          Url: 'https://511ga.org/map/Cctv/186',
          Status: 'Enabled',
          Description: 'I-285 Eastbound at Ashford Dunwoody',
        },
      ],
    }),
  );
  assert.equal(fromView.headingDeg, 90);
  assert.equal(fromView.headingConfidence, 'high');

  const hashed = atlantaCameraToSource(
    row({
      Direction: '',
      Views: [
        {
          Url: 'https://511ga.org/map/Cctv/186',
          Status: 'Enabled',
          Description: 'Courtland Street',
        },
      ],
    }),
  );
  assert.ok(Number.isFinite(hashed.headingDeg));
  assert.equal(hashed.headingConfidence, 'low');
  // The low-confidence personality, so the HUD does not imply a known facing.
  assert.equal(hashed.pitchDeg, -18);
  assert.equal(hashed.fovDeg, 44);
  assert.equal(hashed.rangeM, 145);
});

test('only enabled views are used, and a view flagged down is deprioritized', () => {
  assert.equal(
    pickAtlantaCctvView([
      { Url: 'https://511ga.org/map/Cctv/1', Status: 'Disabled' },
    ]),
    null,
  );
  const picked = pickAtlantaCctvView([
    {
      Url: 'https://511ga.org/map/Cctv/1',
      Status: 'Enabled',
      Description: 'Camera is down',
    },
    {
      Url: 'https://511ga.org/map/Cctv/2',
      Status: 'Enabled',
      Description: 'I-20 WB at Moreland',
    },
  ]);
  assert.equal(picked.url, 'https://511ga.org/map/Cctv/2');
  // A camera whose only view is flagged still gets a frame to try.
  const onlyDown = pickAtlantaCctvView([
    {
      Url: 'https://511ga.org/map/Cctv/1',
      Status: 'Enabled',
      Description: 'Camera is down',
    },
  ]);
  assert.equal(onlyDown.url, 'https://511ga.org/map/Cctv/1');
  assert.equal(pickAtlantaCctvView(null), null);
  assert.equal(pickAtlantaCctvView([]), null);
});

test('a catalog edit cannot steer the frame proxy off the 511GA host', () => {
  assert.equal(
    normalizeAtlantaCctvUrl('https://511ga.org/map/Cctv/186'),
    'https://511ga.org/map/Cctv/186',
  );
  // The vendor also serves these under traveliq.co, the same allowance Ontario makes.
  assert.equal(
    normalizeAtlantaCctvUrl('https://ga.traveliq.co/map/Cctv/186'),
    'https://511ga.org/map/Cctv/186',
  );
  for (const hostile of [
    'https://evil.example/map/Cctv/186',
    'https://511ga.org.evil.test/map/Cctv/186',
    'http://511ga.org/map/Cctv/186', // plaintext
    'https://511ga.org/admin/186', // wrong path shape
    'https://511ga.org/map/Cctv/../../etc/passwd',
    'file:///etc/passwd',
    'not a url',
    '',
  ]) {
    assert.equal(normalizeAtlantaCctvUrl(hostile), '', hostile);
  }
});

test('records outside Georgia and unusable rows are dropped', () => {
  assert.ok(isLikelyGeorgiaCoordinate(33.7537, -84.3903));
  assert.ok(!isLikelyGeorgiaCoordinate(30.2672, -97.7431)); // Austin
  assert.ok(!isLikelyGeorgiaCoordinate(0, 0)); // null island
  assert.ok(!isLikelyGeorgiaCoordinate(-84.3903, 33.7537)); // swapped

  assert.equal(
    atlantaCameraToSource(row({ Latitude: 30.2672, Longitude: -97.7431 })),
    null,
  );
  assert.equal(atlantaCameraToSource(row({ Latitude: 0, Longitude: 0 })), null);
  assert.equal(atlantaCameraToSource(row({ Id: '' })), null);
  assert.equal(atlantaCameraToSource(row({ Views: [] })), null);
  assert.equal(
    atlantaCameraToSource(
      row({
        Views: [{ Url: 'https://evil.example/map/Cctv/1', Status: 'Enabled' }],
      }),
    ),
    null,
  );
  assert.equal(atlantaCameraToSource(null), null);
});

test('a nameless record still gets a label', () => {
  assert.equal(
    atlantaCameraToSource(row({ Location: '', Name: 'GDOT Camera 186' })).name,
    'GDOT Camera 186',
  );
  assert.equal(
    atlantaCameraToSource(row({ Location: '', Name: '', Roadway: 'I-285' }))
      .name,
    'I-285',
  );
  assert.equal(
    atlantaCameraToSource(row({ Location: '', Name: '', Roadway: '' })).name,
    'Georgia 511 Camera 186',
  );
});

test('the pack stays off — and silent — until a key is configured', async (t) => {
  await withKey(undefined, async () => {
    assert.equal(atlantaApiKey(), '');
    const fetched = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
      fetched.push(String(url));
      return Response.json([]);
    });
    assert.deepEqual(await loadAtlantaSourcesFromOpenData(), []);
    // Not merely an empty result: no request is spent being told "Invalid Key".
    assert.deepEqual(fetched, []);
  });
  await withKey('   ', async () => assert.equal(atlantaApiKey(), ''));
});

test('the loader sends the key and sorts metro Atlanta first', async (t) => {
  t.mock.method(console, 'log', () => {});
  await withKey('test-key-123', async () => {
    const requested = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
      requested.push(new URL(String(url)));
      return Response.json([
        // Savannah: a real Georgia camera, but 400 km from the anchors.
        row({
          Id: 900,
          Latitude: 32.0809,
          Longitude: -81.0912,
          Location: 'I-16 EB at Chatham Pkwy',
        }),
        row(),
        // Same Id twice: one camera, not two.
        row({ Location: 'I-75/85 NB at Courtland St (duplicate)' }),
        row({
          Views: [{ Url: 'https://evil.example/x.jpg', Status: 'Enabled' }],
        }),
      ]);
    });

    const cameras = await loadAtlantaSourcesFromOpenData();
    assert.equal(requested.length, 1);
    assert.equal(
      requested[0].origin + requested[0].pathname,
      'https://511ga.org/api/v2/get/cameras',
    );
    assert.equal(requested[0].searchParams.get('key'), 'test-key-123');
    assert.equal(requested[0].searchParams.get('format'), 'json');
    // Downtown before Savannah, duplicate collapsed, off-host row dropped.
    assert.deepEqual(
      cameras.map((camera) => camera.id),
      ['ga-186', 'ga-900'],
    );
  });
});

test('a failed request never echoes the key into the logs', async (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => {
    warnings.push(args.map(String).join(' '));
  });
  await withKey('super-secret-key', async () => {
    t.mock.method(
      globalThis,
      'fetch',
      async () => new Response('Invalid Key', { status: 400 }),
    );
    assert.deepEqual(await loadAtlantaSourcesFromOpenData(), []);
  });
  assert.ok(warnings.length > 0, 'the failure should be reported');
  for (const line of warnings) {
    assert.ok(!line.includes('super-secret-key'), `key leaked: ${line}`);
  }
});
