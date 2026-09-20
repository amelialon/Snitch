# In-app live interviews and recording

## Current behavior

- Create a room under Live interviews and copy its candidate invitation link.
- Both participants join the app directly after consent. No Daily/Zoom room, account, or external
  website is part of the call flow. Live canary audio is removed. The adaptive visual screen watermark was removed on 2026-09-20.

Historical (2026-09-19): the browser test used to check that the screen watermark survived WebRTC and
recording encoding. That watermark and check are gone; the test still covers both microphone tones, the three
video tiles, recording recovery, upload and review creation.
- The interviewer's browser records both cameras, both microphone streams, and the shared
  screen. With a screen present, it occupies the main area and both camera tiles remain visible.
  Screen/system audio is not included. Camera and microphone mute controls affect the recording.
- End interview finalizes the final media chunk before stopping capture. The video uploads to
  the backend and enters the existing review pipeline. Candidate departure also ends the call.
- A live record with no recording becomes the review. If the room belongs to a previous review,
  a new review is created so the previous recording/report remains intact.
- Failed uploads retain the video with preview, download, and retry. Chunks are saved every
  three seconds in IndexedDB; reopening the room in the same browser offers recovery. Successful
  upload removes the local recovery copy. Do not clear browser storage before saving a recording.

## Verified on 2026-09-19

42 backend tests passed. New tests cover signaling between two roles, duplicate-role rejection,
unknown rooms, recording consent and container checks, media retrieval, automatic review
processing, retry deduplication, and preservation of previous reviews.

TypeScript and targeted ESLint checks passed. A real browser integration test exercised two
RTCPeerConnections and the actual MediaRecorder, canvas compositor, audio bus, and IndexedDB.
It used a temporary backend on port 8001 and synthetic inputs, so no real camera/microphone data
or vendor services were accessed.

The final successful browser run recorded 575,180 bytes and verified:

1. Both participants connected through the app's WebSocket signaling.
2. Camera, microphone, and separate screen-share tracks arrived.
3. The saved IndexedDB blob matched the completed recording's size.
4. Decoded playback pixels contained the shared screen and both camera tiles.
5. Both participants' distinct test audio tones were recovered from the encoded recording.
6. Stopping screen sharing cleared the receiver's screen state.
7. Upload automatically produced a ready review through the normal pipeline using a synthetic
   transcriber. Retrying returned the same review instead of launching another processing job.

The test exposed and fixed answer-side transceiver negotiation and remote-audio rendering
issues. The recorder keeps a muted audio rendering sink so remote audio reaches the recording
even without a mounted participant preview.

To repeat: run `backend/tests/dev_live_server.py` using the backend virtual environment, then
open `/live/self-test` on the frontend development server. This route is unavailable in
production. The test uses synthetic transcription, not an accuracy test of a speech vendor.

## Operational limits

- Localhost invitation links only work on the same computer. For other devices, host the app
  and API on reachable HTTPS/WSS addresses and configure the API origin/CORS accordingly.
- WebRTC uses direct connections by default. Restrictive or separate networks may need a
  deployment-operated TURN server configured through `WEBRTC_ICE_SERVERS`. Participants still
  use only this app. There is no production relay service bundled with the repository.
- Use one API worker: the signaling registry is in memory. Recording review tasks also retain
  the application's existing in-process background-task model. A process crash can require a
  review rerun; receipt-based retries do not launch duplicate paid analysis jobs.
- A closed/crashed tab may lose its last unflushed recording chunk. Background browser throttling
  can reduce canvas frame rate. Large recordings consume browser memory and storage quota.
- The existing vendor credentials/adapters are still needed for real video transcription and
  analysis; the offline JSON transcriber cannot transcribe a video recording.
- Physical devices, Internet NAT/TURN, hour-long calls, and abrupt browser crashes were not part
  of the synthetic integration run. The original demo's lack of authentication is unchanged.
