"""Receive the Clip SDK's live Opus stream and commit it on STREAM_END."""

import asyncio
from contextlib import suppress
from time import monotonic

from clip.exceptions import CommandError, TransferError, TransferTimeoutError
from clip.stream import STREAM_END_STOPPED, StreamCapture, StreamReceiver

from audio import decode

MAX_SECONDS = 120
MAX_FRAMES = MAX_SECONDS * 50  # The firmware encodes one 20 ms Opus packet per frame.


class RtcError(TransferError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class RtcReceiver(StreamReceiver):
    def __init__(self, sid, capture):
        self.sid = sid
        self.capture = capture
        self.previous = None
        super().__init__(self.save)

    def save(self, packet):
        if self.capture.frames < MAX_FRAMES:
            self.capture.feed(packet)

    def _on_start(self, frame):
        if frame.session_id != self.sid:
            raise RtcError("rtc-incomplete", "unexpected RTC stream session")
        super()._on_start(frame)

    def _on_data(self, frame):
        if frame == self.previous:
            return
        if not 1 <= len(frame.payload) <= 1275 or frame.sequence != (self.frames_received & 0xFFFF):
            raise RtcError("rtc-incomplete", "invalid RTC Opus packet or discontinuous sequence")
        super()._on_data(frame)
        self.previous = frame

    def _fail(self, error):
        super()._fail(error)
        # Wake wait_start too when the stream fails before STREAM_START.
        self.started.set()


class RtcCapture:
    def __init__(self, client, sid, folder):
        self.client = client
        self.sid = sid
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.capture = StreamCapture(folder / "live.opus")
        self.receiver = RtcReceiver(sid, self.capture)
        self.device_stopped = False
        self.end_deadline = None

    def mark_stopped(self):
        self.device_stopped = True
        if not self.receiver.ended.is_set() and self.end_deadline is None:
            self.end_deadline = asyncio.get_running_loop().call_later(
                2, self.receiver._fail, RtcError(
                    "rtc-incomplete" if self.capture.frames else "rtc-empty", "missing RTC end frame"))

    def lose_link(self):
        self.device_stopped = True
        if not self.receiver.ended.is_set():
            self.receiver._fail(RtcError("rtc-interrupted", "BLE disconnected during RTC capture"))

    async def stop(self, lock):
        async with lock:
            if self.device_stopped or self.receiver.end_reason is not None:
                return
            try:
                await self.client.stop_recording()
            except CommandError:
                if not self.device_stopped and self.receiver.end_reason is None:
                    raise
            self.mark_stopped()

    async def receive(self, lock):
        token = None
        try:
            async with lock:
                if self.device_stopped:
                    raise RtcError("rtc-empty", "Clip stopped before receiving RTC audio")
                token = await self.client.stream_rtc(self.sid, self.receiver)
            try:
                await self.receiver.wait_start(9)
            except TransferTimeoutError as error:
                raise RtcError("rtc-unavailable", "Clip did not begin RTC transmission") from error
            try:
                await self.receiver.wait_end(MAX_SECONDS)
            except TransferTimeoutError:
                await self.stop(lock)
                await self.receiver.wait_end(3)
            if self.receiver.end_reason != STREAM_END_STOPPED:
                raise RtcError("rtc-interrupted", "Clip ended the RTC stream abnormally")
            if not self.capture.frames:
                raise RtcError("rtc-empty", "Clip sent no RTC audio")
            self.capture.finish(normal_end=True)
        except Exception:
            if self.client.is_connected:
                with suppress(Exception):
                    await self.stop(lock)
            raise
        finally:
            self.client.transport.detach_file_frame_handler(token)
            if self.end_deadline is not None:
                self.end_deadline.cancel()
            self.capture.abort()
            self.capture.part_path.unlink(missing_ok=True)


async def decode_rtc(folder):
    recording = folder / "live.opus"
    if not recording.is_file():
        raise RtcError("rtc-unavailable", "RTC audio is missing from the local cache")
    start = monotonic()
    try:
        result = await decode([recording], folder / "speech.wav", 16000, 1)
    except (OSError, ValueError) as error:
        raise RtcError("decode-failed", str(error)) from error
    return {**result, "downloadMs": 0, "decodeMs": (monotonic() - start) * 1000}
