"""Decode Clip's length-prefixed Opus packets into a mono 16 kHz WAV."""

import asyncio
import ctypes as C
from pathlib import Path
import sys
import wave


async def decode(parts: list[Path], target: Path, rate: int, channels: int) -> dict:
    if rate not in (8000, 12000, 16000, 24000, 48000) or channels not in (1, 2):
        raise ValueError("unsupported recording format")
    # libopus can decode directly at 16 kHz regardless of encoder sample rate.
    library = Path(getattr(sys, "_MEIPASS", Path(__file__).parent)) / "libopus.so.0"
    opus = C.CDLL(str(library) if library.is_file() else "libopus.so.0")
    opus.opus_decoder_create.argtypes = [C.c_int, C.c_int, C.POINTER(C.c_int)]
    opus.opus_decoder_create.restype = C.c_void_p
    opus.opus_decode.argtypes = [C.c_void_p, C.c_char_p, C.c_int32,
                                C.POINTER(C.c_int16), C.c_int, C.c_int]
    opus.opus_decoder_destroy.argtypes = [C.c_void_p]
    status = C.c_int()
    decoder = opus.opus_decoder_create(16000, channels, C.byref(status))
    if not decoder:
        raise ValueError(f"Opus decoder initialization failed ({status.value})")
    buffer = (C.c_int16 * (1920 * channels))()
    output_part = target.with_suffix(".wav.part")
    frames = 0
    packets = 0
    try:
        with wave.open(str(output_part), "wb") as output:
            output.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            for part in parts:
                with part.open("rb") as source:
                    while prefix := source.read(2):
                        length = int.from_bytes(prefix, "little")
                        if len(prefix) != 2 or not 1 <= length <= 1275:
                            raise ValueError(f"{part.name}: invalid Opus packet length")
                        packet = source.read(length)
                        if len(packet) != length:
                            raise ValueError(f"{part.name}: truncated Opus packet")
                        samples = opus.opus_decode(decoder, packet, length, buffer, 1920, 0)
                        if samples <= 0:
                            raise ValueError(f"{part.name}: Opus decode failed ({samples})")
                        frames += samples
                        if frames > 16000 * 3600:
                            raise ValueError("recording exceeds the 60 minute worker limit")
                        if channels == 2:
                            for i in range(samples):
                                buffer[i] = (buffer[i * 2] + buffer[i * 2 + 1]) // 2
                        output.writeframesraw(C.string_at(buffer, samples * 2))
                        packets += 1
                        if packets % 128 == 0:
                            await asyncio.sleep(0)
        if frames == 0:
            raise ValueError("recording does not contain audio")
        output_part.replace(target)
        return {"wav": str(target), "durationSeconds": frames / 16000, "wavBytes": target.stat().st_size}
    finally:
        opus.opus_decoder_destroy(decoder)
        output_part.unlink(missing_ok=True)
