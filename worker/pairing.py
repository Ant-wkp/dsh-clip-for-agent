"""A scoped BlueZ Just Works agent for hosts without a desktop pairing agent."""

import asyncio
from contextlib import suppress

from dbus_fast import BusType
from dbus_fast.aio import MessageBus
from dbus_fast.errors import DBusError
from dbus_fast.service import ServiceInterface, method

AGENT_PATH = "/org/respeaker/Clip/Agent"
REJECTED = "org.bluez.Error.Rejected"


class ClipAgent(ServiceInterface):
    def __init__(self, device_path):
        super().__init__("org.bluez.Agent1")
        self.device_path = device_path

    def accept(self, path):
        if path != self.device_path:
            raise DBusError(REJECTED, "unexpected pairing device")

    @method()
    def Release(self):
        pass

    @method()
    def Cancel(self):
        pass

    @method()
    def RequestAuthorization(self, device: "o"):
        self.accept(device)

    @method()
    def RequestConfirmation(self, device: "o", passkey: "u"):
        self.accept(device)

    @method()
    def AuthorizeService(self, device: "o", uuid: "s"):
        self.accept(device)


async def pair_clip(path):
    # BlueZ uses an application's own agent for Pair() on the same bus client.
    bus = await MessageBus(bus_type=BusType.SYSTEM).connect()
    try:
        async def pairing():
            manager = bus.get_proxy_object("org.bluez", "/org/bluez",
                                           await bus.introspect("org.bluez", "/org/bluez"))
            agent = ClipAgent(path)
            bus.export(AGENT_PATH, agent)
            agents = manager.get_interface("org.bluez.AgentManager1")
            await agents.call_register_agent(AGENT_PATH, "NoInputNoOutput")
            try:
                device = bus.get_proxy_object("org.bluez", path, await bus.introspect("org.bluez", path))
                try:
                    await device.get_interface("org.bluez.Device1").call_pair()
                except DBusError as error:
                    if error.type != "org.bluez.Error.AlreadyExists":
                        raise
            finally:
                with suppress(DBusError):
                    await agents.call_unregister_agent(AGENT_PATH)

        await asyncio.wait_for(pairing(), 15)
    finally:
        bus.disconnect()
