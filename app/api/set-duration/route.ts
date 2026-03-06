import { getRoom, safeRoomId, updateDuration } from "../../../lib/rooms-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const room = getRoom(safeRoomId(body.roomId));
  const playerId = body.playerId;
  if (!room || !room.seats[playerId]) {
    return Response.json({ error: "Room or player not found" }, { status: 404 });
  }
  updateDuration(room, body.durationSeconds);
  return Response.json({ ok: true });
}
