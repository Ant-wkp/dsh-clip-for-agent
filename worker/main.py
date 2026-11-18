"""Private Clip worker. Stdout carries protocol v1 only."""

import asyncio
import json
from contextlib import suppress
from pathlib import Path
import sys

if sys.platform == "win32":
    sys.coinit_flags = 0  # WinRT callbacks need an MTA for this console process.

from clip.exceptions import CommandTimeoutError

from audio import load_opus
from device import Device


def send(message):
    sys.stdout.write(json.dumps(message, separators=(",", ":"), ensure_ascii=True, allow_nan=False) + "\n")
    sys.stdout.flush()


async def serve(workspace: Path):
    device = Device(workspace, lambda name, payload: send({"event": name, "data": payload}))
    methods = {
        "scan": device.scan,
        "connect": device.connect,
        "disconnect": device.disconnect,
        "status": device.status,
        "startRtc": device.start_rtc,
        "stopRtc": device.stop_rtc,
        "startSd": device.start_sd,
        "stopSd": device.stop_sd,
        "finishRtc": device.finish_rtc,
        "downloadAndDecode": device.download,
        "latestRecording": device.latest_recording,
    }
    limit = 16384
    transport = None
    if sys.platform == "win32":
        # Windows asyncio can't attach a StreamReader to this inherited stdin pipe.
        async def readline():
            return await asyncio.to_thread(sys.stdin.buffer.readline, limit + 1)
    else:
        stream = asyncio.StreamReader(limit=limit)
        transport, _ = await asyncio.get_running_loop().connect_read_pipe(
            lambda: asyncio.StreamReaderProtocol(stream), sys.stdin.buffer)
        readline = stream.readline
    try:
        load_opus()
        send({"event": "ready", "data": {"protocol": 1}})
        while line := await readline():
            if len(line) > limit:
                raise ValueError("Clip worker request is too long")
            request = json.loads(line)
            method = request["method"]
            rid = request["id"]
            args = request.get("args", [])
            try:
                result = True if method == "ping" and not args else await methods[method](*args)
                send({"id": rid, "ok": True, "value": result})
            except Exception as error:
                if isinstance(error, CommandTimeoutError):
                    with suppress(Exception):
                        await device.disconnect()
                    send({"event": "disconnected", "data": {"reason": "AT command timed out"}})
                code = "link-lost" if isinstance(error, CommandTimeoutError) else getattr(error, "code", None)
                send({"id": rid, "ok": False, "error": str(error)[:300], "code": code})
    finally:
        if transport is not None:
            transport.close()
        await device.disconnect()


if __name__ == "__main__":
    asyncio.run(serve(Path(sys.argv[1]).resolve()))
