import asyncio
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import wave

from clip import ClipClient
from clip.transports.base import BaseTransport

from device import Device, matches_reply

SID = "20261118123456"
ADDRESS = "FA:00:00:00:00:01"
OPUS_SILENCE = bytes.fromhex("f8fffe")


class ClipTransportFixture(BaseTransport):
    def __init__(self):
        super().__init__()
        self.is_open = True
        self.commands = []
        self.attached = asyncio.Event()

    @property
    def is_connected(self):
        return self.is_open

    async def connect(self):
        self.is_open = True

    async def disconnect(self):
        self.is_open = False

    def start_event(self):
        self._emit_event({"event": "state", "state": "STREAMING", "session": SID})

    def packet(self, sequence):
        self._emit_file_frame(struct.pack("<BHH", 0x14, sequence, len(OPUS_SILENCE)) + OPUS_SILENCE)

    def end_frames(self):
        self._emit_file_frame(b"\x15\x00")
        self._emit_event({"event": "state", "state": "IDLE", "session": SID})

    async def send_command(self, command, *, timeout):
        self.commands.append(command)
        if command == "AT+START=rtc":
            self.start_event()
            data = {"session": SID, "mode": "rtc"}
        elif command == f"AT+DOWNLOAD={SID}":
            self._emit_file_frame(b"\x13\x0e" + SID.encode("ascii"))
            self.attached.set()
            data = {"state": "streaming", "session": SID}
        elif command == "AT+STOP":
            self.end_frames()
            data = {"session": SID}
        else:
            raise AssertionError(f"unexpected command: {command}")
        response = {"ok": True, "data": data}
        assert matches_reply(command, response)
        return response


class RtcTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        workspace = tempfile.TemporaryDirectory()
        self.addCleanup(workspace.cleanup)
        self.events = []
        self.device = Device(Path(workspace.name), lambda name, data: self.events.append((name, data)))
        self.transport = ClipTransportFixture()
        self.device.client = ClipClient(self.transport)
        self.device.client.on_event(self.device.on_event)
        self.device.address = ADDRESS
        self.addAsyncCleanup(self.device.disconnect)

    async def wait_attached(self):
        await asyncio.wait_for(self.transport.attached.wait(), 2)
        return self.device.rtc_task

    async def test_host_start_stop_collects_live_packets_once(self):
        self.assertTrue(await self.device.start_rtc())
        task = await self.wait_attached()
        self.device.recording_state("RECORDING", SID, polled=True)
        self.transport.packet(0)
        self.transport.packet(0)
        self.transport.packet(1)
        self.assertTrue(await self.device.stop_rtc())
        await asyncio.wait_for(task, 2)
        self.assertEqual(self.transport.commands, ["AT+START=rtc", f"AT+DOWNLOAD={SID}", "AT+STOP"])
        phases = [event["phase"] for name, event in self.events if name == "recording"]
        self.assertEqual(phases, ["recording", "stopped"])
        result = await self.device.finish_rtc(ADDRESS, SID)
        with wave.open(result["wav"], "rb") as audio:
            self.assertEqual((audio.getnchannels(), audio.getframerate(), audio.getnframes()), (1, 16000, 640))
        self.assertIsNone(self.transport._file_frame_handler)

    async def test_firmware_start_and_stop_commits_before_link_notification(self):
        self.transport.start_event()
        task = await self.wait_attached()
        self.transport.packet(0)
        self.transport.end_frames()
        self.transport.is_open = False
        self.transport._emit_event({"event": "link-lost"})
        await asyncio.wait_for(task, 2)
        self.assertEqual(self.transport.commands, [f"AT+DOWNLOAD={SID}"])
        self.assertEqual(self.events[-2][1]["phase"], "stopped")
        self.assertEqual(self.events[-1][0], "disconnected")
        self.assertTrue(self.device.rtc_folder(ADDRESS, SID).joinpath("live.opus").is_file())

    async def test_disconnect_without_end_discards_partial_recording(self):
        self.transport.start_event()
        task = await self.wait_attached()
        self.transport.packet(0)
        self.transport.is_open = False
        self.transport._emit_event({"event": "link-lost"})
        await asyncio.wait_for(task, 2)
        self.assertEqual(self.events[-2][1]["code"], "rtc-interrupted")
        self.assertEqual(list(self.device.rtc_folder(ADDRESS, SID).iterdir()), [])

    async def test_sequence_gap_discards_partial_recording(self):
        self.transport.start_event()
        task = await self.wait_attached()
        self.transport.packet(0)
        self.transport.packet(2)
        await asyncio.wait_for(task, 2)
        self.assertEqual(self.events[-1][1]["code"], "rtc-incomplete")
        self.assertEqual(list(self.device.rtc_folder(ADDRESS, SID).iterdir()), [])

    async def test_duration_limit_stops_clip_and_keeps_the_capture(self):
        with patch("rtc.MAX_SECONDS", 0.05):
            self.transport.start_event()
            task = await self.wait_attached()
            self.transport.packet(0)
            await asyncio.wait_for(task, 2)
        self.assertEqual(self.transport.commands[-1], "AT+STOP")
        self.assertEqual(self.events[-1][1]["phase"], "stopped")
