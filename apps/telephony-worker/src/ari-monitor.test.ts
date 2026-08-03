import { EventEmitter } from "node:events";
import type { ClientOptions } from "ws";
import { createLogger } from "@omni/observability";
import { describe, expect, it, vi } from "vitest";
import { AriMonitor, type AriSocket } from "./ari-monitor";

class SocketDouble extends EventEmitter implements AriSocket {
  close = vi.fn();
}

const config = {
  url: "http://localhost:8088",
  username: "omni_ari",
  password: "a".repeat(32),
  application: "omnichannel",
};

const logger = createLogger({
  service: "telephony-worker-test",
  level: "silent",
  pretty: false,
});

async function startMonitor(
  socket: SocketDouble,
  onPermanentFailure = vi.fn(),
) {
  const connector = vi.fn((_url: URL, _options: ClientOptions) => socket);
  const monitor = new AriMonitor(config, logger, onPermanentFailure, connector);
  const started = monitor.start();
  socket.emit("open");
  await started;
  return { connector, monitor, onPermanentFailure };
}

describe("AriMonitor", () => {
  it("autentica por cabeçalho e assina todos os eventos", async () => {
    const socket = new SocketDouble();
    const { connector } = await startMonitor(socket);

    const [url, options] = connector.mock.calls[0] ?? [];
    expect(url?.toString()).toBe(
      "ws://localhost:8088/ari/events?app=omnichannel&subscribeAll=true",
    );
    expect(options?.headers?.Authorization).toMatch(/^Basic /);
    expect(url?.toString()).not.toContain(config.password);
  });

  it("fecha o WebSocket ao parar", async () => {
    const socket = new SocketDouble();
    const { monitor } = await startMonitor(socket);

    monitor.stop();

    expect(socket.close).toHaveBeenCalledWith(1000, "shutdown");
  });

  it("avisa o supervisor quando a conexão fecha", async () => {
    const socket = new SocketDouble();
    const { onPermanentFailure } = await startMonitor(socket);

    socket.emit("close", 1006, Buffer.from("indisponível"));

    expect(onPermanentFailure).toHaveBeenCalledOnce();
  });

  it("ignora uma segunda chamada de start enquanto está conectado", async () => {
    const socket = new SocketDouble();
    const { connector, monitor } = await startMonitor(socket);

    await monitor.start();

    expect(connector).toHaveBeenCalledOnce();
  });

  it("entrega eventos de gravação em ordem ao processador", async () => {
    const socket = new SocketDouble();
    const { monitor } = await startMonitor(socket);
    const handler = vi.fn();
    monitor.onRecordingEvent(handler);

    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "ChannelUserevent",
          eventname: "OmniRecordingStarted",
          userevent: {
            RecordingId: "20260731-1.1",
            CallId: "1.1",
            Direction: "outbound",
            Provider: "wavoip",
            FromNumber: "1001",
            ToNumber: "5511999999999",
            Extension: "1001",
          },
        }),
      ),
    );

    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "started",
        recordingId: "20260731-1.1",
        callId: "1.1",
        extension: "1001",
        provider: "wavoip",
      }),
    );
  });
});
