- Treat 511-platform "no feed" cards as a missing CCTV frame rather than a
  frame. The CARS/511 platform answers a dead camera with HTTP 200 and a fixed
  image instead of an error, which pinned a black rectangle onto the camera's
  projection plane and skipped the Street View and synthetic fallbacks. The
  three observed cards are matched by exact SHA-256, with a size prefilter that
  skips anything frame-sized, so the existing fallback chain runs — the
  provider-agnostic form of the MLIT river adjustment check. Health and the
  fallback card now distinguish "upstream reports the camera offline" from
  "upstream unavailable", which are different operator problems (iggz, #1725).
