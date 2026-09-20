# Screen-share watermark validation

## Checks run on 2026-09-19

- TypeScript typecheck and ESLint on changed frontend code.
- Backend suite: 37 tests, including consented live creation, missing recordings, share identity
  persistence, idempotent writes, immutable settings, end timestamps, and exact identifier checks.
- Five frontend unit tests: light/dark background colors, texture avoidance and relocation,
  hysteresis and bounds, no activation before decoded frames, track cleanup, and canceled capture.
- Browser smoke test of `/live` and the calibration page in Chromium/Codex's browser.
- Six actual local WebRTC encode/decode trials, snapshotting the receiver video rather than the
  source canvas. VP8, 1280×720, 15 fps input, 1 Mbps sender cap, 23–24 decoded frames per trial.

Recovery below was performed by the coding assistant visually reading each decoded image at
native resolution, then submitting that transcription before the expected identifier was
revealed. An uncertain read was recorded as a miss. This is a small smoke test, not an OCR
benchmark or a statistical estimate of AI detection reliability.

| Opacity | Background-relative RGB offset | Light exact recovery | Dark exact recovery |
|---|---|---|---|
| 20% | 60 | 0/1 | 0/1 |
| 35% | 80 | 1/1 | 1/1 |
| 50% | 100 | 1/1 | 1/1 |

35% / 80 is the least visible tested setting recovered in both of these samples and remains
the experimental starting setting. Do not interpret 2/2 as a reliable production threshold.
The darker/lighter foreground uses the local mean RGB with the specified offset; alpha blending
then attenuates that difference. Font size also scales with source height.

| UTC timestamp | Background | Opacity / offset | Expected identifier | Recovered |
|---|---|---|---|---|
| 21:49:27.495 | light | 35% / 80 | workingTotal_f9b926bf6e | exact |
| 21:50:48.371 | light | 20% / 60 | workingTotal_b188e967ac | no confident read |
| 21:52:05.724 | light | 50% / 100 | workingTotal_45b29e3b11 | exact |
| 21:54:54.511 | dark | 35% / 80 | workingTotal_7e2eac86d8 | exact |
| 21:56:08.796 | dark | 20% / 60 | workingTotal_9f6ba0d1f0 | no confident read |
| 21:57:50.088 | dark | 50% / 100 | workingTotal_9d2e82bf53 | exact |

## Remote acceptance test (still required)

A configured Daily room and a second participant/device were unavailable in this session.
No claim is made that the local test exercised Daily's SFU, real network compression, a remote
OS screenshot, or an external OCR service. The synthetic input also does not exercise the
browser's display-selection permission dialog.

1. Create a Daily room, enter its URL in the live room, and join from two desktop browsers/devices.
   Use synthetic interview content. Grant screen-share permissions on the sender.
2. Test tab, window, and entire-screen capture, including canceled/denied selection. The overlay
   must remain inactive until captured frames and SDK confirmation arrive.
3. Confirm the receiver sees the adaptive watermark and the original microphone audio. The
   receiver can use Daily Prebuilt, which displays the transmitted screen track.
4. Capture screenshots on the receiving device at native resolution and common display scales.
   Capture the received recording too if recordings are part of the intended workflow.
5. Give only each screenshot to the chosen OCR/detection tool, withholding the expected marker.
   Record the recovered text, exact-match result, font/resolution, opacity, RGB offset, browser,
   device, codec, network conditions, and watermark position.
6. Repeat each visibility setting on at least 20 distinct light/dark/busy screens with fresh
   markers. Report exact recoveries divided by attempts for each setting and condition.
   Use the minimum visibility meeting the project's stated recovery target across conditions;
   a single successful read is not sufficient.
7. Scroll/switch content and resize the capture. Confirm relocation and color adaptation do
   not obscure important text. Dense pages may have no genuinely empty region; pixel heuristics
   do not recognize semantic UI controls.
8. Test browser Stop sharing, in-app Stop, source/window closure, canceled startup, leaving the
   call, navigation, and connection loss. Confirm raw/composited tracks stop and the watermark
   disappears remotely. Verify persisted timestamps; abrupt process termination may leave an
   absent end timestamp. An API failure must prevent starting unlogged transmission.
9. Test the app while sharing another window and while backgrounded/minimized; browser timer
   throttling may reduce canvas output frame rate. Keep the sender active for initial testing.

The local calibration page can additionally capture a selected screen through the same
compositor and export the decoded PNG plus measurement JSON. It deliberately does not claim
that a locally visible preview proves remote delivery or that a match proves misconduct.
