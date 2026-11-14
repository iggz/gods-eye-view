- Add Georgia 511 (Atlanta) traffic cameras as a CCTV source pack. 511GA runs
  the same CARS/511 platform as the Ontario pack, so the catalog and the
  `/map/Cctv/<id>` still frames follow that shape, with frames pinned to the
  511GA host. Like Ontario it needs a free developer key: GDOT answers an
  unkeyed request with HTTP 400, so the pack stays off and spends no request
  until `CCTV_ATLANTA_KEY` is set (https://511ga.org/developers/doc; the key is
  never written to a log line). The catalog is statewide, so metro anchors plus
  `CCTV_ATLANTA_MAX_SOURCES` (default 250) scope it to Atlanta; raising either
  reaches Savannah, Macon and Augusta. 511GA publishes a per-camera
  `Direction`, so 226 of the 250 cameras get a real facing rather than the
  id-hash fallback. Ground heights under all 250 are precomputed against
  Google 3D Tiles (median 271 m). `CCTV_ATLANTA_ENABLED=0` turns the pack off
  (iggz, #1726).
