import { getRoom, joinRoom, safeRoomId } from "../../../lib/rooms-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const roomId = safeRoomId(body.roomId);
  const room = getRoom(roomId);
  if (!room) {
    return Response.json({ error: "Room not found" }, { status: 404 });
  }
  const joined = joinRoom(room, body.playerName, body.playerColor);
  if (!joined) {
    return Response.json({ error: "Room is full" }, { status: 409 });
  }
  return Response.json(joined);
}
