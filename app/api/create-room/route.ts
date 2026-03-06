import type { NextRequest } from "next/server";
import { createRoom } from "../../../lib/rooms-store";

export const runtime = "nodejs";

function getBaseUrl(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedHost && forwardedProto) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl(request);
  const room = createRoom(baseUrl);
  return Response.json({
    roomId: room.id,
    inviteUrl: `${baseUrl}/play?room=${room.id}`
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const baseUrl = getBaseUrl(request);
  const room = createRoom(baseUrl, {
    mode: body.mode,
    maxPlayers: body.maxPlayers,
    winCondition: body.winCondition,
    durationSeconds: body.durationSeconds,
    scoreLimit: body.scoreLimit,
    selfCollisionAllowed: body.selfCollisionAllowed,
    snakeCollisionAllowed: body.snakeCollisionAllowed,
    fireEnabled: body.fireEnabled
  });
  return Response.json({
    roomId: room.id,
    inviteUrl: `${baseUrl}/play?room=${room.id}`
  });
}
