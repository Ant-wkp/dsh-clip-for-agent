"""BLE integration for the current reSpeaker Clip SDK."""

import asyncio
from dataclasses import asdict
import json
from pathlib import Path
import re
import sys
from time import monotonic
import zlib

from bleak import BleakClient, BleakScanner
from bleak.exc import BleakDBusError
from clip import ClipClient
from clip.exceptions import CommandError, ConnectionError, ProtocolError, TransferError, TransferTimeoutError
from clip.protocol import AUDIO_VIS_UUID, FILE_DATA_UUID, RESPONSE_UUID, SERVICE_UUID, JsonNotificationDecoder
from clip.transfer import FileReceiver
from clip.transports.ble import BleTransport
from clip.validation import chunk_name, session_id

from audio import decode
from rtc import RtcCapture, decode_rtc

if sys.platform.startswith("linux"):
    from pairing import pair_clip

ADDRESS = re.compile(r"(?:[0-9A-F]{2}:){5}[0-9A-F]{2}")
ACTIVE_STATES = {"RECORDING", "PAUSED", "STREAMING"}


class SyncError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def unpack_levels(payload: bytes) -> list[int]:
    if len(payload) == 13:
        return [min(10, level) for level in payload]
    if len(payload) == 7:
        return [min(10, (payload[i // 2] >> (4 * (i % 2))) & 15) for i in range(13)]
    return []


def matches_reply(command, response):
    # Clip responses aren't tagged with the command. Only admit a successful
    # response when its shape matches the pending command.
    if response.get("ok") is False:
        return True
    if response.get("ok") is not True:
        return False
    data = response.get("data")
    data = data if isinstance(data, dict) else {}
    if command == "AT+GSTAT":
        return isinstance(data.get("state"), str) and isinstance(data.get("recording"), bool)
    if command == "AT+LIST" or command.startswith("AT+LIST?"):
        return isinstance(data.get("sessions"), list)
    if command.startswith("AT+LIST="):
        if "?" in command:
            return isinstance(data.get("files"), list)
        return type(data.get("files")) is int and type(data.get("size")) is int
    if command.startswith("AT+DOWNLOAD="):
        sid = command.split("=", 1)[1].split(":", 1)[0]
        return data.get("state") in {"transmitting", "streaming"} and data.get("session") == sid
    if command == "AT+START=rtc":
        return data.get("mode") == "rtc" and isinstance(data.get("session"), str)
    if command == "AT+STOP":
        return isinstance(data.get("session"), str)
    if command == "AT+CANCEL":
        return data.get("canceled") is True
    return True


class ClipTransport(BleTransport):
    """Use SDK framing and serialization, adding explicit pairing and VU GATT."""

    def __init__(self, address, *, connect_timeout):
        super().__init__(address, connect_timeout=connect_timeout)
        self._request_lock = asyncio.Lock()
        self._expected_reply = None
        self._partial_fragment = None

    async def send_command(self, command, *, timeout):
        async with self._request_lock:
            self._expected_reply = command
            try:
                return await super().send_command(command, timeout=timeout)
            finally:
                self._expected_reply = None

    def _on_response_notification(self, _sender, data):
        raw = bytes(data)
        if raw == self._partial_fragment:
            return
        try:
            responses = self._decoder.feed(raw)
            self._partial_fragment = None if responses else raw
            for response in responses:
                if "event" in response:
                    self._emit_event(response)
                elif self._expected_reply and matches_reply(self._expected_reply, response):
                    self._expected_reply = None
                    self._responses.put_nowait(response)
        except ProtocolError:
            self._desynchronized = True

    async def _subscribe(self, client, characteristic, callback):
        if not sys.platform.startswith("linux"):
            await client.start_notify(characteristic, callback)
            return
        try:
            await client.start_notify(characteristic, callback, bluez={"use_start_notify": False})
        except BleakDBusError as error:
            if error.dbus_error not in {
                "org.bluez.Error.InProgress", "org.bluez.Error.NotSupported",
                "org.bluez.Error.NotPermitted", "org.freedesktop.DBus.Error.UnknownMethod",
            }:
                raise
            await client.start_notify(characteristic, callback)

    async def connect(self):
        if self.is_connected:
            return
        def disconnected(client):
            if self._client is client:
                self._connected = False
                self._emit_event({"event": "link-lost"})

        device = await BleakScanner.find_device_by_address(self.address, timeout=self.connect_timeout)
        if device is None:
            raise ValueError("Clip is not advertising")
        client = BleakClient(device, timeout=self.connect_timeout, pair=True,
                             disconnected_callback=disconnected)
        self._decoder = JsonNotificationDecoder()
        self._partial_fragment = None
        self._drain_responses()
        try:
            try:
                await client.connect()
            except BleakDBusError as error:
                if not sys.platform.startswith("linux") or error.dbus_error != "org.bluez.Error.AuthenticationFailed":
                    raise
                await pair_clip(device.details["path"])
                client = BleakClient(device, timeout=self.connect_timeout, pair=False,
                                     disconnected_callback=disconnected)
                await client.connect()
            await self._subscribe(client, RESPONSE_UUID, self._on_response_notification)
            await self._subscribe(client, FILE_DATA_UUID, self._on_file_notification)
            await self._subscribe(client, AUDIO_VIS_UUID, self._visualization)
        except BaseException:
            if client.is_connected:
                try:
                    await client.disconnect()
                except Exception:
                    pass
            raise
        self._client = client
        self._connected = True
        self._desynchronized = False

    def _visualization(self, _sender, data):
        levels = unpack_levels(data)
        if levels:
            self._emit_event({"event": "levels", "levels": levels})


class VerifiedReceiver(FileReceiver):
    """Record checksums only after the SDK has validated and committed a file."""

    def __init__(self, transport, sid, path, progress, verified, expected):
        super().__init__(transport, sid, path, udp=False, progress=progress)
        self.verified = verified
        self.expected = set(expected)
        self.last_frame = monotonic()
        self.previous_frame = None

    def feed(self, frame):
        # File DATA has a sequence number. Identical consecutive complete
        # frames on BLE are notification duplicates, not extra audio bytes.
        if self.done.is_set() or frame == self.previous_frame:
            return
        self.previous_frame = frame
        self.last_frame = monotonic()
        super().feed(frame)

    async def wait(self, timeout):
        deadline = monotonic() + timeout
        while not self.done.is_set():
            now = monotonic()
            remaining = min(deadline, self.last_frame + 12) - now
            if remaining <= 0:
                raise TransferTimeoutError("Clip transfer stopped sending file frames")
            try:
                await asyncio.wait_for(self.done.wait(), remaining)
            except asyncio.TimeoutError:
                # A frame may have arrived before the idle timer expired.
                continue
        if self.error is not None:
            raise self.error

    def _on_file_start(self, frame):
        if frame.filename not in self.expected or frame.size > 64 * 1024 * 1024:
            raise ValueError("unexpected Clip part or part size")
        super()._on_file_start(frame)

    def _on_file_end(self, frame):
        super()._on_file_end(frame)
        part = self.files[-1]
        self.verified[part.name] = [part.size_bytes, frame.crc32]
        manifest = self.output_dir / "verified.json"
        partial = manifest.with_suffix(".part")
        partial.write_text(json.dumps(self.verified), encoding="utf-8")
        partial.replace(manifest)


def valid_part(path: Path, expected) -> bool:
    if not expected or not path.is_file() or path.stat().st_size != expected[0]:
        return False
    crc = 0
    with path.open("rb") as source:
        while payload := source.read(65536):
            crc = zlib.crc32(payload, crc)
    return crc == expected[1]


class Device:
    def __init__(self, workspace, emit):
        self.workspace = workspace
        self.emit = emit
        self.client = None
        self.address = None
        self.active = None
        self.phase = None
        self.last_level = 0.0
        self.monitor = None
        self.receiver = None
        self.rtc = None
        self.rtc_task = None
        self.last_rtc = None
        self.lock = asyncio.Lock()

    async def scan(self, *, seconds=4):
        discovered = await BleakScanner.discover(timeout=seconds, return_adv=True)
        devices = []
        for device, advertisement in discovered.values():
            name = advertisement.local_name or device.name or ""
            # The UART UUID is also used by unrelated devices. Named devices
            # must identify as Clip; retain unnamed advertisements with the UUID.
            named_clip = name.casefold().startswith(("clip", "respeaker"))
            unnamed_uart = not name and SERVICE_UUID.lower() in advertisement.service_uuids
            if not (named_clip or unnamed_uart):
                continue
            if ADDRESS.fullmatch(device.address.upper()):
                devices.append({"id": device.address.upper(), "name": name or "reSpeaker Clip",
                                "rssi": advertisement.rssi})
        return sorted(devices, key=lambda item: item["rssi"], reverse=True)[:64]

    async def connect(self, address):
        if not isinstance(address, str) or not ADDRESS.fullmatch(address):
            raise ValueError("invalid BLE address")
        await self.disconnect()
        self.address = address
        self.client = ClipClient(ClipTransport(address, connect_timeout=20))
        self.client.on_event(self.on_event)
        try:
            await self.client.connect()
            status = await self.client.status()
        except BaseException:
            await self.disconnect()
            raise
        self.reconcile(status)
        self.monitor = asyncio.create_task(self.watch())
        return {"id": address, "name": status.device_name, "battery": status.battery_percent}

    async def disconnect(self):
        if self.monitor:
            self.monitor.cancel()
            await asyncio.gather(self.monitor, return_exceptions=True)
            self.monitor = None
        client, self.client = self.client, None
        rtc_task = self.rtc_task
        if self.rtc:
            self.rtc.lose_link()
        try:
            if client:
                await client.disconnect()
        finally:
            if rtc_task:
                await rtc_task
            self.active = self.phase = self.address = self.last_rtc = None
        return True

    def on_event(self, data):
        if data.get("event") == "link-lost":
            self.active = self.phase = None
            if self.receiver:
                self.receiver._fail(SyncError("link-lost", "BLE connection lost during transfer"))
            self.notice_link_loss("BLE link lost")
            return
        if data.get("event") == "levels":
            now = monotonic()
            if self.phase == "recording" and now - self.last_level >= 0.095:
                self.last_level = now
                self.emit("levels", {"recordingId": self.active, "levels": data["levels"],
                                     "transport": "rtc" if self.rtc else "sd"})
        if data.get("event") == "state":
            self.recording_state(data.get("state"), data.get("session"))

    def notice_link_loss(self, reason):
        def notify(_task=None):
            self.emit("disconnected", {"reason": reason})

        if self.rtc and self.rtc_task:
            self.rtc.lose_link()
            # A valid STREAM_END already delivered before the disconnect can
            # still commit the recording and should reach DSH first.
            self.rtc_task.add_done_callback(notify)
        else:
            notify()

    def recording_state(self, state, sid, *, polled=False):
        if state in ACTIVE_STATES:
            try:
                sid = session_id(sid)
            except (TypeError, ValueError):
                return
            if state == "STREAMING":
                self.begin_rtc(sid)
                return
            if self.rtc or (polled and sid == self.last_rtc):
                # GSTAT reports RTC as RECORDING. Only the start notification
                # and the AT+START=rtc response identify it as RTC.
                return
            phase = "paused" if state == "PAUSED" else "recording"
            if (self.active, self.phase) != (sid, phase):
                self.active, self.phase = sid, phase
                self.emit("recording", {"recordingId": sid, "phase": phase})
        elif state == "IDLE" and self.rtc and (not sid or sid == self.rtc.sid):
            self.rtc.mark_stopped()
        elif state == "IDLE" and self.active and (not sid or sid == self.active):
            ended, self.active = self.active, None
            self.phase = None
            self.emit("recording", {"recordingId": ended, "phase": "stopped"})

    def reconcile(self, status):
        self.recording_state(status.state, status.session_id, polled=True)

    async def watch(self):
        try:
            while self.client:
                await asyncio.sleep(2)
                async with self.lock:
                    self.reconcile(await self.client.status())
        except asyncio.CancelledError:
            raise
        except Exception:
            self.notice_link_loss("BLE link lost or unresponsive")
            client, self.client = self.client, None
            try:
                if client:
                    await client.disconnect()
            except Exception:
                pass
            self.active = self.phase = self.address = None

    async def status(self):
        async with self.lock:
            return asdict(await self.require_client().status())

    def require_client(self):
        if not self.client or not self.client.is_connected:
            raise SyncError("link-lost", "Clip is not connected")
        return self.client

    def begin_rtc(self, sid):
        if self.rtc or self.last_rtc == sid or self.client is None or self.address is None:
            return
        self.last_rtc = sid
        try:
            capture = RtcCapture(self.client, sid, self.rtc_folder(self.address, sid))
        except OSError:
            self.emit_rtc(sid, "failed", "rtc-cache")
            return
        self.rtc = capture
        self.active, self.phase = sid, "recording"
        self.emit_rtc(sid, "recording")
        self.rtc_task = asyncio.create_task(self.receive_rtc(capture))

    def emit_rtc(self, sid, phase, code=None):
        data = {"recordingId": sid, "phase": phase, "transport": "rtc"}
        if code:
            data["code"] = code
        self.emit("recording", data)

    async def receive_rtc(self, capture):
        error_code = None
        try:
            await capture.receive(self.lock)
        except Exception as error:
            error_code = getattr(error, "code", None) or "rtc-incomplete"
        finally:
            self.rtc = self.rtc_task = None
            self.active = self.phase = None
        self.emit_rtc(capture.sid, "failed" if error_code else "stopped", error_code)

    async def start_rtc(self):
        async with self.lock:
            client = self.require_client()
            if self.rtc or self.active:
                raise SyncError("still-recording", "Clip is already recording")
            try:
                sid = session_id(await client.start_rtc())
            except CommandError as error:
                raise SyncError("rtc-unavailable", str(error)) from error
            self.begin_rtc(sid)
            return True

    async def stop_rtc(self):
        if self.rtc:
            await self.rtc.stop(self.lock)
        return True

    def rtc_folder(self, address, sid):
        if not isinstance(address, str) or not ADDRESS.fullmatch(address):
            raise ValueError("invalid BLE address")
        return self.workspace / address.replace(":", "") / ("rtc-" + session_id(sid))

    async def finish_rtc(self, address, sid):
        return await decode_rtc(self.rtc_folder(address, sid))

    async def latest_recording(self):
        async with self.lock:
            client = self.require_client()
            status = await client.status()
            if self.rtc or status.state in ACTIVE_STATES:
                raise SyncError("still-recording", "Stop recording before fetching the latest file")
            sessions = await client.list_sessions(per_page=5)
            for session in sessions:
                if session.files > 0 and session.size_bytes > 0:
                    return session_id(session.id)
            raise SyncError("no-recording", "Clip has no completed recording to recover")

    async def download(self, recording_id):
        # Retry one interrupted or incomplete stream while the same BLE link
        # is healthy. The manifest reuses only CRC-verified files.
        for attempt in range(2):
            try:
                return await self._download_once(recording_id)
            except TransferError as error:
                if not self.client or not self.client.is_connected:
                    raise SyncError("link-lost", str(error)) from error
                if attempt:
                    code = "transfer-timeout" if isinstance(error, TransferTimeoutError) else "transfer-incomplete"
                    raise SyncError(code, str(error)) from error
                self.emit("downloading", {"recordingId": recording_id, "stage": "retrying"})
                await asyncio.sleep(0.5)
            except ConnectionError as error:
                raise SyncError("link-lost", str(error)) from error
            except CommandError as error:
                code = "file-not-ready" if str(error) == "Session or file not found" else "device-rejected"
                raise SyncError(code, str(error)) from error

    async def _download_once(self, recording_id):
        sid = session_id(recording_id)
        async with self.lock:
            client = self.require_client()
            if self.rtc:
                raise SyncError("still-recording", "Stop RTC before syncing an SD recording")
            details, names = await self.finalized_files(client, sid)
            folder = self.workspace / self.address.replace(":", "") / sid
            folder.mkdir(mode=0o700, parents=True, exist_ok=True)
            manifest = folder / "verified.json"
            try:
                verified = json.loads(manifest.read_text(encoding="utf-8"))
            except (FileNotFoundError, json.JSONDecodeError):
                verified = {}
            remaining = [name for name in names if not valid_part(folder / name, verified.get(name))]
            start = monotonic()
            if remaining:
                suffix = names[names.index(remaining[0]):]
                receiver = VerifiedReceiver(client.transport, sid, folder,
                                            self.progress_for(sid), verified, suffix)
                self.receiver = receiver
                client.transport.set_file_frame_handler(receiver.feed)
                started = False
                try:
                    try:
                        await client.start_download(sid, start_file=suffix[0])
                    except CommandError as error:
                        if str(error) in {"Busy", "Transfer already in progress"}:
                            raise TransferError(str(error)) from error
                        raise
                    started = True
                    await receiver.wait(timeout=180)
                    if {part.name for part in receiver.files} != set(suffix):
                        raise TransferError("transfer ended with missing parts")
                except Exception:
                    if started and client.is_connected:
                        try:
                            await client.cancel_download()
                        except Exception:
                            pass
                    raise
                finally:
                    self.receiver = None
                    client.transport.set_file_frame_handler(None)
                    receiver.close()
            opus_bytes = sum((folder / name).stat().st_size for name in names)
            if opus_bytes != details.size_bytes:
                # The next attempt must recheck the source, not reuse the
                # same complete-looking cache after a size mismatch.
                manifest.unlink(missing_ok=True)
                raise TransferError("verified recording size differs from the Clip file listing")
            download_ms = (monotonic() - start) * 1000
            self.emit("downloading", {"recordingId": sid, "stage": "decoding"})
        start = monotonic()
        try:
            result = await decode([folder / name for name in names], folder / "audio.wav",
                                  details.sample_rate_hz, details.channels)
        except ValueError as error:
            raise SyncError("decode-failed", str(error)) from error
        return dict(result, id=sid, parts=len(names), downloadMs=download_ms,
                    decodeMs=(monotonic() - start) * 1000,
                    opusBytes=opus_bytes)

    async def finalized_files(self, client, sid):
        # STOP notification and final indexed segment can arrive in either order.
        # Require two matching listings with a nonempty set after the recording is closed.
        previous = None
        for _ in range(12):
            try:
                status = await client.status()
                if status.session_id != sid or status.state not in ACTIVE_STATES:
                    details = await client.session_details(sid)
                    if details.files > 2048 or details.size_bytes > 64 * 1024 * 1024:
                        raise ValueError("recording exceeds worker transfer limits")
                    names = []
                    for page in range(1, (details.files + 19) // 20 + 1):
                        names.extend(chunk_name(name) for name in await client.list_files(sid, page_number=page))
                    names.sort()
                    current = (details.files, details.size_bytes, names)
                    if names and len(set(names)) == details.files == len(names) and current == previous:
                        return details, names
                    previous = current
                else:
                    previous = None
            except CommandError:
                previous = None
            await asyncio.sleep(0.25)
        raise SyncError("file-not-ready", "recording file listing did not settle")

    def progress_for(self, sid):
        last = 0.0

        def progress(name, received, size):
            nonlocal last
            now = monotonic()
            if now - last >= 0.2 or received == size:
                last = now
                self.emit("downloading", {"recordingId": sid, "stage": "downloading",
                                          "file": name, "received": received, "bytes": size})
        return progress
