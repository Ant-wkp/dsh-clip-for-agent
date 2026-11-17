"""Private Clip worker. Stdout carries protocol v1 only."""

import asyncio
import json
from contextlib import suppress
from pathlib import Path
import sys

from clip.exceptions import CommandTimeoutError

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
        "downloadAndDecode": device.download,
        "latestRecording": device.latest_recording,
    }
    loop = asyncio.get_running_loop()
    stream = asyncio.StreamReader(limit=16384)
    transport, _ = await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(stream), sys.stdin.buffer)
    send({"event": "ready", "data": {"protocol": 1}})
    try:
        while line := await stream.readline():
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
        transport.close()
        await device.disconnect()


if __name__ == "__main__":
    asyncio.run(serve(Path(sys.argv[1]).resolve()))
