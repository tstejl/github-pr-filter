import { test } from "bun:test";
import { once } from "node:events";
import { createConnection } from "node:net";
import { startFixtureServer } from "./harness/fixture";

test("fixture cleanup closes unfinished HTTP connections", async () => {
  const fixture = await startFixtureServer();
  const url = new URL(fixture.url);
  const socket = createConnection({ host: url.hostname, port: Number(url.port) });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let closed: Promise<void> | undefined;
  try {
    await once(socket, "connect");
    const response = once(socket, "data");
    socket.write("POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\nx");
    await response;
    closed = fixture.close();
    await Promise.race([
      closed,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error("Fixture shutdown waited for the client")),
          1_000
        );
      })
    ]);
  } finally {
    clearTimeout(deadline);
    socket.destroy();
    await (closed ?? fixture.close());
  }
});
