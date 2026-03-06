import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { getRoom, handleWsInput, registerWsClient, safeRoomId } from "./lib/rooms-store";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      res.statusCode = 500;
      res.end("Internal server error");
      console.error(error);
    });
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const roomId = safeRoomId(url.searchParams.get("roomId"));
      const playerId = url.searchParams.get("playerId");
      const room = getRoom(roomId);
      if (!room || (playerId !== "p1" && playerId !== "p2") || !room.seats[playerId]) {
        ws.close();
        return;
      }

      const unregister = registerWsClient(room, playerId, ws);
      ws.on("message", (raw) => {
        try {
          const message = JSON.parse(String(raw));
          const result = handleWsInput(room, playerId, message);
          if (result.fired) {
            ws.send(JSON.stringify({ type: "fired" }));
          }
        } catch {
          ws.send(JSON.stringify({ type: "error", error: "Invalid message" }));
        }
      });
      ws.on("close", unregister);
      ws.on("error", unregister);
    });
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
