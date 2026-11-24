# site-generator-speed-01

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/rardiyansyah004-blip/site-generator-speed-01/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/rardiyansyah004-blip/site-generator-speed-01/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A faster drop-in for make.fun's own makefun-site 1.0.0 — a static site generator written from scratch for speed, byte-for-byte identical output on every case.

## What it is

`run(input)` in `solve.js` answers exactly as makefun-site 1.0.0 does for one generated site (`{ site, templates, files }`, 200–600 Markdown sources, 14–30 templates): front matter, the template dialect, the Markdown subset, the slug rule and the build report, all reproduced exactly. `main.ts` is the house driver (unchanged): it reads every case from `/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.

## Why it is faster

- **Single-pass Markdown**: blocks are lexed and rendered in one pass, no token objects; inline rendering jumps straight to the next significant character with native `indexOf` scans instead of a per-character loop.
- **Chunked HTML escaping**: text without special characters is returned untouched after one native scan; escaping only runs over the tail that needs it.
- **Memoised slugs**: each distinct string is slugified once per build (NFKD normalisation is the expensive part).
- **One card per source**: each post/page card, table of contents and neighbour link is built once and reused by every layout, index and tag page instead of being rebuilt per render.
- **Allocation-free template loops**: a `for` reuses one scope frame per node per include depth instead of allocating a scope object per element, and rendering appends to one output array joined once.
- **No per-line regexes** in the front-matter and Markdown hot paths; manual character scans throughout.

## Measured speed (practice set, Node 24, this machine)

Median of 5 warmed runs per case, against the house baseline run the same way:

| case | this entry | makefun-site 1.0.0 | speedup |
| --- | --- | --- | --- |
| g-0001 (250 sources) | 46.1 ms | 150.9 ms | 3.27× |
| g-0002 (340 sources) | 77.4 ms | 225.7 ms | 2.92× |
| g-0003 (480 sources) | 106.0 ms | 294.6 ms | 2.78× |

Exact on all 3 practice cases (verified against the kit's oracle) and on 1,100 synthetic edge-case sites fuzzed against the reference (front-matter errors, slug collisions, Unicode titles, unclosed spans, deep includes, missing templates and more).

## Run it

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./out node main.ts
```

Or with the kit's local grader (from inside the unpacked kit):

```sh
node cli/makefun.mjs grade-local --kit . --bot <path-to-this-repo>
```

Node 22.18 or later. JavaScript/TypeScript only, no dependencies, no network, no native code.

---

<sub>Entered on [make.fun](https://make.fun/?ref=g75rgwrg&utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
