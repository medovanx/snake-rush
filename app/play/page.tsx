"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Direction = "up" | "upRight" | "right" | "downRight" | "down" | "downLeft" | "left" | "upLeft";
type WinCondition = "time" | "score";

type Food = {
  x: number;
  y: number;
  variant: number;
  kind: "normal" | "special";
  points: number;
  ttlMs: number | null;
};

type Bullet = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ownerId: "p1" | "p2";
  ttlMs: number;
};

type Impact = {
  id: string;
  x: number;
  y: number;
  ownerId: "p1" | "p2";
  ttlMs: number;
};

type PlayerState = {
  snake: Array<{ x: number; y: number }>;
  direction?: Direction;
  heading?: { x: number; y: number };
  target?: { x: number; y: number };
  score: number;
};

type GameState = {
  width: number;
  height: number;
  durationSeconds: number;
  remainingMs: number;
  winCondition: WinCondition;
  scoreLimit: number | null;
  selfCollisionAllowed: boolean;
  snakeCollisionAllowed: boolean;
  fireEnabled: boolean;
  foods: Food[];
  bullets: Bullet[];
  impacts?: Impact[];
  foodsCollected: number;
  nextSpecialFoodAt: number;
  status: "waiting" | "running" | "gameOver";
  winner: "p1" | "p2" | null;
  players: { p1: PlayerState; p2: PlayerState };
  solo?: {
    targetX: number;
    targetY: number;
    length: number;
  };
};

type JoinResponse = {
  roomId: string;
  playerId: "p1" | "p2";
  playersJoined: number;
  profiles: Record<"p1" | "p2", { name: string; color: string }>;
  state: GameState;
};

const SOLO_TICK_MS = 140;
const SOLO_SPECIAL_FOOD_INTERVAL = 5;
const SOLO_MAX_FOODS = 4;
const SPECIAL_FOOD_LIFETIME_MS = 8000;

const DIRECTION_VECTORS: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  upRight: { x: 1, y: -1 },
  right: { x: 1, y: 0 },
  downRight: { x: 1, y: 1 },
  down: { x: 0, y: 1 },
  downLeft: { x: -1, y: 1 },
  left: { x: -1, y: 0 },
  upLeft: { x: -1, y: -1 }
};

function isOpposite(a: Direction, b: Direction): boolean {
  const av = DIRECTION_VECTORS[a];
  const bv = DIRECTION_VECTORS[b];
  return av.x + bv.x === 0 && av.y + bv.y === 0;
}

function randomFoodForSnake(width: number, height: number, snake: Array<{ x: number; y: number }>): Food | null {
  for (let i = 0; i < 80; i += 1) {
    const point = {
      x: 6 + Math.random() * (width - 12),
      y: 6 + Math.random() * (height - 12)
    };
    const overlaps = snake.some((s) => Math.hypot(s.x - point.x, s.y - point.y) < 4.5);
    if (!overlaps) {
      return {
        x: point.x,
        y: point.y,
        variant: Math.floor(Math.random() * 4),
        kind: "normal",
        points: 1,
        ttlMs: null
      };
    }
  }
  return null;
}

function randomSpecialFoodForSolo(width: number, height: number, snake: Array<{ x: number; y: number }>): Food | null {
  for (let i = 0; i < 80; i += 1) {
    const point = {
      x: 14 + Math.random() * (width - 28),
      y: 14 + Math.random() * (height - 28)
    };
    const overlaps = snake.some((s) => Math.hypot(s.x - point.x, s.y - point.y) < 6.2);
    if (!overlaps) {
      return {
        x: point.x,
        y: point.y,
        variant: Math.floor(Math.random() * 4),
        kind: "special",
        points: 10,
        ttlMs: SPECIAL_FOOD_LIFETIME_MS
      };
    }
  }
  return null;
}

function seedSoloFoods(width: number, height: number, snake: Array<{ x: number; y: number }>, maxFoods = SOLO_MAX_FOODS): Food[] {
  const foods: Food[] = [];
  while (foods.length < maxFoods) {
    const next = randomFoodForSnake(width, height, [...snake, ...foods]);
    if (!next) {
      break;
    }
    foods.push(next);
  }
  return foods;
}

function randomPresetColor() {
  const hue = Math.floor(Math.random() * 360);
  const saturation = 65 + Math.floor(Math.random() * 26);
  const lightness = 52 + Math.floor(Math.random() * 12);
  const a = saturation * Math.min(lightness, 100 - lightness) / 100;
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const color = lightness - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round((255 * color) / 100)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function trimSnakeLength(points: Array<{ x: number; y: number }>, maxLen: number): Array<{ x: number; y: number }> {
  if (!points.length) {
    return points;
  }
  const out = [points[0]];
  let used = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = out[out.length - 1];
    const b = points[i];
    const seg = Math.hypot(a.x - b.x, a.y - b.y);
    if (used + seg <= maxLen) {
      out.push(b);
      used += seg;
      continue;
    }
    const remain = Math.max(0, maxLen - used);
    if (seg > 0 && remain > 0) {
      const t = remain / seg;
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t
      });
    }
    break;
  }
  return out;
}

function createSoloState(selfCollisionAllowed = false): GameState {
  const width = 100;
  const height = 100;
  const p1Snake = Array.from({ length: 14 }, (_, i) => ({
    x: 32 - i * 1.35,
    y: 50
  }));
  return {
    width,
    height,
    durationSeconds: 0,
    remainingMs: 0,
    winCondition: "score",
    scoreLimit: null,
    selfCollisionAllowed,
    snakeCollisionAllowed: false,
    fireEnabled: false,
    foods: seedSoloFoods(width, height, p1Snake),
    bullets: [],
    foodsCollected: 0,
    nextSpecialFoodAt: SOLO_SPECIAL_FOOD_INTERVAL,
    status: "running",
    winner: null,
    players: {
      p1: { snake: p1Snake, direction: "right", heading: { x: 1, y: 0 }, target: { x: 1, y: 0 }, score: 0 },
      p2: { snake: [], direction: "left", heading: { x: -1, y: 0 }, target: { x: -1, y: 0 }, score: 0 }
    },
    solo: {
      targetX: 1,
      targetY: 0,
      length: 19
    }
  };
}

function stepSoloState(state: GameState, nextDirection: Direction): GameState {
  const snake = state.players.p1.snake;
  const solo = state.solo;
  if (!snake.length || !solo) {
    return state;
  }
  const activeFoods = state.foods
    .map((food) => ({
      ...food,
      ttlMs: food.kind === "special" ? Math.max(0, (food.ttlMs ?? SPECIAL_FOOD_LIFETIME_MS) - SOLO_TICK_MS) : null
    }))
    .filter((food) => food.kind !== "special" || (food.ttlMs ?? 0) > 0);
  const head = snake[0];
  const speed = 24;
  const dt = SOLO_TICK_MS / 1000;
  const targetMag = Math.hypot(solo.targetX, solo.targetY) || 1;
  const delta = {
    x: solo.targetX / targetMag,
    y: solo.targetY / targetMag
  };
  const nextHead = {
    x: head.x + delta.x * speed * dt,
    y: head.y + delta.y * speed * dt
  };
  const wrappedHead = {
    x: nextHead.x < 0 ? state.width + nextHead.x : nextHead.x >= state.width ? nextHead.x - state.width : nextHead.x,
    y: nextHead.y < 0 ? state.height + nextHead.y : nextHead.y >= state.height ? nextHead.y - state.height : nextHead.y
  };
  const eatenFood = activeFoods.find((f) => Math.hypot(f.x - wrappedHead.x, f.y - wrappedHead.y) < 3.3) || null;
  const rawSnake = [wrappedHead, ...snake];
  const nextLength = eatenFood ? solo.length + (eatenFood.kind === "special" ? 10 : 5) : solo.length;
  const nextSnake = trimSnakeLength(rawSnake, nextLength);
  const hitsSelf =
    state.selfCollisionAllowed &&
    nextSnake.slice(1).some((segment) => Math.hypot(segment.x - nextHead.x, segment.y - nextHead.y) < 1.6);
  if (hitsSelf) {
    return { ...state, status: "gameOver", winner: null };
  }

  let nextFoods = activeFoods;
  let nextFoodsCollected = state.foodsCollected;
  let nextSpecialFoodAt = state.nextSpecialFoodAt;
  if (eatenFood) {
    nextFoods = activeFoods.filter((food) => food !== eatenFood);
    const shouldSpawnSpecial = eatenFood.kind === "normal" && nextFoodsCollected + 1 >= nextSpecialFoodAt;
    if (eatenFood.kind === "normal") {
      nextFoodsCollected += 1;
    }
    if (shouldSpawnSpecial) {
      const specialReplacement = randomSpecialFoodForSolo(state.width, state.height, nextSnake);
      if (specialReplacement) {
        nextFoods = [...nextFoods, specialReplacement];
        nextSpecialFoodAt += SOLO_SPECIAL_FOOD_INTERVAL;
      }
    }
  }

  while (nextFoods.length < SOLO_MAX_FOODS) {
    const replacement = randomFoodForSnake(state.width, state.height, [...nextSnake, ...nextFoods]);
    if (!replacement) {
      break;
    }
    nextFoods = [...nextFoods, replacement];
  }

  let nextDirectionValue: Direction = nextDirection;
  const angle = Math.atan2(delta.y, delta.x);
  const oct = Math.round(angle / (Math.PI / 4));
  const ordered: Direction[] = ["right", "downRight", "down", "downLeft", "left", "upLeft", "up", "upRight"];
  nextDirectionValue = ordered[((oct % 8) + 8) % 8];

  return {
    ...state,
    foods: nextFoods,
    foodsCollected: nextFoodsCollected,
    nextSpecialFoodAt,
    players: {
      p1: {
        ...state.players.p1,
        snake: nextSnake,
        direction: nextDirectionValue,
        heading: delta,
        target: delta,
        score: state.players.p1.score + (eatenFood ? eatenFood.points : 0)
      },
      p2: state.players.p2
    },
    solo: {
      ...solo,
      length: nextLength
    }
  };
}

async function api<T>(path: string, method = "GET", body: unknown = null): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : null
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = payload.error || "Request failed";
    const error = new Error(message) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return payload as T;
}

function clearRoomQueryParam() {
  if (typeof window === "undefined") {
    return;
  }
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.delete("room");
  window.history.replaceState({}, "", nextUrl);
}

function buildInviteUrl(roomId: string) {
  if (typeof window === "undefined") {
    return `/play?room=${roomId}`;
  }
  return `${window.location.origin}/play?room=${roomId}`;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) {
    throw new Error("copy_failed");
  }
}

function friendlyErrorMessage(error: unknown): string {
  const text = String((error as { message?: string })?.message || "");
  if (text === "Room is full") {
    return "This room is already full. Ask the host to create a new room.";
  }
  if (text === "Room not found") {
    return "Room not found. Check the invite link or ask for a new one.";
  }
  return "Request failed. Check connection and try again.";
}

function buildSnakePath(
  points: Array<{ x: number; y: number }>,
  width: number | null,
  height: number | null,
  center = true
): string {
  if (!points.length) {
    return "";
  }

  const adjustedPoints = points.reduce<Array<{ x: number; y: number }>>((acc, point, index) => {
    if (index === 0 || width === null || height === null) {
      acc.push({ ...point });
      return acc;
    }

    const prev = acc[index - 1];
    const candidateX = [point.x - width, point.x, point.x + width].sort(
      (a, b) => Math.abs(a - prev.x) - Math.abs(b - prev.x)
    )[0];
    const candidateY = [point.y - height, point.y, point.y + height].sort(
      (a, b) => Math.abs(a - prev.y) - Math.abs(b - prev.y)
    )[0];
    acc.push({ x: candidateX, y: candidateY });
    return acc;
  }, []);

  return adjustedPoints
    .map((point, index) => {
      const x = center ? point.x + 0.5 : point.x;
      const y = center ? point.y + 0.5 : point.y;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function directionToAngle(direction: Direction): number {
  return Math.atan2(DIRECTION_VECTORS[direction].y, DIRECTION_VECTORS[direction].x);
}

function headingToAngle(heading?: { x: number; y: number }, fallback: Direction = "right"): number {
  if (!heading) {
    return directionToAngle(fallback);
  }
  return Math.atan2(heading.y, heading.x);
}

function renderSnakeHead(
  point: { x: number; y: number } | undefined,
  angleRadians: number,
  kind: "solo" | "p1" | "p2",
  color?: string
) {
  if (!point) {
    return null;
  }
  const cx = point.x;
  const cy = point.y;
  const scale = kind === "solo" ? 1 : 1;
  const angle = (angleRadians * 180) / Math.PI;

  return (
    <g transform={`translate(${cx} ${cy}) rotate(${angle}) scale(${scale})`} className={`snake-head ${kind}`}>
      <ellipse className="snake-head-shape" rx="2.6" ry="2.1" style={color ? { fill: color } : undefined} />
      <path className="snake-head-mark" d="M-0.6 -1.15 L1 -0.2 L-0.6 0.75" />
      <circle className="snake-eye" cx="0.5" cy="-0.62" r="0.26" />
      <circle className="snake-eye" cx="0.5" cy="0.62" r="0.26" />
      <circle className="snake-eye-glint" cx="0.62" cy="-0.7" r="0.08" />
      <circle className="snake-eye-glint" cx="0.62" cy="0.54" r="0.08" />
    </g>
  );
}

function getEndgameSummary(
  state: GameState,
  playMode: "menu" | "solo" | "multiplayer",
  profiles: Record<"p1" | "p2", { name: string; color: string }>
) {
  if (playMode === "solo") {
    return {
      title: "Game Over",
      body: `Final score: ${state.players.p1.score}`,
      detail: ""
    };
  }
  if (state.winner) {
    const loser = state.winner === "p1" ? "p2" : "p1";
    return {
      title: `${profiles[state.winner]?.name || state.winner.toUpperCase()} Wins`,
      body: `${profiles[loser]?.name || loser.toUpperCase()} Loses`,
      detail: `Score ${state.players.p1.score} - ${state.players.p2.score}`
    };
  }
  return {
    title: "Draw",
    body: "Both players are out.",
    detail: `Final score ${state.players.p1.score} - ${state.players.p2.score}`
  };
}

function renderFood(food: Food, key: string, isSolo: boolean) {
  const cx = food.x;
  const cy = food.y;
  const scale = isSolo ? 1 : 1;
  if (food.kind === "special") {
    return (
      <g key={key} transform={`translate(${cx} ${cy}) scale(${scale})`}>
        <g className="special-food-pulse">
          <circle className="special-food-ring" r="5.2">
            <animateTransform
              attributeName="transform"
              type="scale"
              values="0.88;1.12;0.88"
              dur="0.95s"
              repeatCount="indefinite"
            />
          </circle>
        </g>
        <image
          href="/images/food/special/bashameel.png"
          x="-4.2"
          y="-4.2"
          width="8.4"
          height="8.4"
          preserveAspectRatio="xMidYMid meet"
          className="special-food-image"
        />
      </g>
    );
  }
  const bodyClass = `fruit-body fruit-v${food.variant}`;
  const leafClass = `fruit-leaf fruit-v${food.variant}`;

  if (food.variant === 1) {
    return (
      <g key={key} transform={`translate(${cx} ${cy}) scale(${scale})`}>
        <ellipse className={bodyClass} rx="2.15" ry="1.7" />
        <rect className="fruit-stem" x="-0.16" y="-2.1" width="0.32" height="0.7" rx="0.12" />
        <ellipse className={leafClass} cx="0.8" cy="-1.7" rx="0.65" ry="0.34" transform="rotate(-22)" />
      </g>
    );
  }

  if (food.variant === 2) {
    return (
      <g key={key} transform={`translate(${cx} ${cy}) scale(${scale})`}>
        <path className={bodyClass} d="M0 -2.2 C1.6 -2.1 2.2 -0.9 2.2 0.2 C2.2 1.6 1.1 2.2 0 2.2 C-1.1 2.2 -2.2 1.6 -2.2 0.2 C-2.2 -0.9 -1.6 -2.1 0 -2.2Z" />
        <rect className="fruit-stem" x="-0.14" y="-2.55" width="0.28" height="0.68" rx="0.12" />
        <ellipse className={leafClass} cx="-0.9" cy="-1.9" rx="0.62" ry="0.3" transform="rotate(28)" />
      </g>
    );
  }

  if (food.variant === 3) {
    return (
      <g key={key} transform={`translate(${cx} ${cy}) scale(${scale})`}>
        <path className={bodyClass} d="M0 -2.05 C1.1 -2.05 2.15 -1.2 2.15 0.15 C2.15 1.55 1.1 2.2 0 2.2 C-1.1 2.2 -2.15 1.55 -2.15 0.15 C-2.15 -1.2 -1.1 -2.05 0 -2.05Z" />
        <path className={leafClass} d="M0 -2.05 C0.28 -2.95 0.95 -3.35 1.75 -3.15 C1.25 -2.55 0.78 -2.15 0 -2.05Z" />
      </g>
    );
  }

  return (
    <g key={key} transform={`translate(${cx} ${cy}) scale(${scale})`}>
      <circle className={bodyClass} r="2.05" />
      <rect className="fruit-stem" x="-0.14" y="-2.45" width="0.28" height="0.72" rx="0.12" />
      <ellipse className={leafClass} cx="0.82" cy="-1.82" rx="0.62" ry="0.3" transform="rotate(-20)" />
    </g>
  );
}

function renderWrappedPathCopies(
  d: string,
  width: number,
  height: number,
  render: (key: string, transform: string) => React.JSX.Element
) {
  if (!d) {
    return null;
  }
  const copies = [];
  for (const offsetX of [-width, 0, width]) {
    for (const offsetY of [-height, 0, height]) {
      copies.push(render(`${offsetX}:${offsetY}`, `translate(${offsetX} ${offsetY})`));
    }
  }
  return copies;
}

export default function Page() {
  const [playMode, setPlayMode] = useState<"menu" | "solo" | "multiplayer">("menu");
  const [roomId, setRoomId] = useState("");
  const [pendingRoomId, setPendingRoomId] = useState("");
  const [playerId, setPlayerId] = useState<"" | "p1" | "p2">("");
  const [playerNameInput, setPlayerNameInput] = useState("");
  const [playerColorInput, setPlayerColorInput] = useState("#58d27f");
  const [copyInviteLabel, setCopyInviteLabel] = useState("Copy Invite");
  const [inviteUrl, setInviteUrl] = useState("#");
  const [profiles, setProfiles] = useState<Record<"p1" | "p2", { name: string; color: string }>>({
    p1: { name: "Player 1", color: "#58d27f" },
    p2: { name: "Player 2", color: "#5ab5ff" }
  });
  const [playersJoined, setPlayersJoined] = useState(0);
  const [state, setState] = useState<GameState | null>(null);
  const [statusText, setStatusText] = useState("Choose a mode to start.");
  const [errorText, setErrorText] = useState("");
  const [popupText, setPopupText] = useState("");
  const [resultPopup, setResultPopup] = useState<{ title: string; body: string; detail: string } | null>(null);
  const [winCondition, setWinCondition] = useState<WinCondition>("time");
  const [durationInput, setDurationInput] = useState(120);
  const [scoreLimitInput, setScoreLimitInput] = useState(10);
  const [soloSelfCollisionAllowed, setSoloSelfCollisionAllowed] = useState(false);
  const [selfCollisionAllowed, setSelfCollisionAllowed] = useState(false);
  const [snakeCollisionAllowed, setSnakeCollisionAllowed] = useState(false);
  const [fireEnabled, setFireEnabled] = useState(false);
  const soloNextDirectionRef = useRef<Direction>("right");
  const boardRef = useRef<HTMLElement | null>(null);
  const lastTargetRef = useRef<string>("");
  const wsRef = useRef<WebSocket | null>(null);
  const wsIntentionalCloseRef = useRef(false);
  const [pointerIndicator, setPointerIndicator] = useState({ x: 50, y: 50, angle: 0, visible: false });
  const [joystickState, setJoystickState] = useState({ active: false, x: 0, y: 0 });
  const biteAudioRef = useRef<HTMLAudioElement | null>(null);
  const hitAudioRef = useRef<HTMLAudioElement | null>(null);
  const victoryAudioRef = useRef<HTMLAudioElement | null>(null);
  const beepAudioRef = useRef<HTMLAudioElement | null>(null);
  const powerUpAudioRef = useRef<HTMLAudioElement | null>(null);
  const scoreRef = useRef<{ p1: number; p2: number } | null>(null);
  const previousStatusRef = useRef<GameState["status"] | null>(null);
  const specialVisibleRef = useRef(false);

  const clearError = useCallback(() => setErrorText(""), []);
  const showError = useCallback((message: string) => setErrorText(message || ""), []);
  const hidePopup = useCallback(() => setPopupText(""), []);
  const showPopup = useCallback((message: string) => setPopupText(message || ""), []);
  const fireMultiplayerShot = useCallback(async () => {
    if (playMode !== "multiplayer" || !roomId || !playerId || !state?.fireEnabled || !wsRef.current) {
      return;
    }
    wsRef.current.send(JSON.stringify({ type: "fire" }));
  }, [playMode, playerId, roomId, state?.fireEnabled]);
  const resetToMenu = useCallback(() => {
    wsIntentionalCloseRef.current = true;
    wsRef.current?.close();
    setPlayMode("menu");
    setRoomId("");
    setPendingRoomId("");
    setPlayerId("");
    setInviteUrl("#");
    setProfiles({
      p1: { name: "Player 1", color: "#58d27f" },
      p2: { name: "Player 2", color: "#5ab5ff" }
    });
    setPlayersJoined(0);
    setState(null);
    setErrorText("");
    setPopupText("");
    setStatusText("Choose a mode to start.");
    setPointerIndicator((prev) => ({ ...prev, visible: false }));
    setResultPopup(null);
    clearRoomQueryParam();
  }, []);
  const startSoloGame = useCallback(() => {
    wsIntentionalCloseRef.current = true;
    wsRef.current?.close();
    setPlayMode("solo");
    setRoomId("");
    setPendingRoomId("");
    setPlayerId("");
    setInviteUrl("#");
    setState(createSoloState(soloSelfCollisionAllowed));
    soloNextDirectionRef.current = "right";
    lastTargetRef.current = "";
    setStatusText("Move inside the board to steer.");
    clearError();
    setResultPopup(null);
    clearRoomQueryParam();
  }, [clearError, soloSelfCollisionAllowed]);

  const joinRoom = useCallback(
    async (targetRoomId: string) => {
      const normalized = String(targetRoomId || "").trim().toUpperCase();
      const joined = await api<JoinResponse>("/api/join-room", "POST", {
        roomId: normalized,
        playerName: playerNameInput.trim(),
        playerColor: playerColorInput
      });
      setPlayMode("multiplayer");
      clearError();
      hidePopup();
      setRoomId(joined.roomId);
      setPendingRoomId("");
      setPlayerId(joined.playerId);
      setState(joined.state);
      setPlayersJoined(joined.playersJoined);
      setInviteUrl(buildInviteUrl(joined.roomId));
      setProfiles(joined.profiles);
      setDurationInput(joined.state.durationSeconds);
      if (joined.state.scoreLimit) {
        setScoreLimitInput(joined.state.scoreLimit);
      }
      setSelfCollisionAllowed(joined.state.selfCollisionAllowed);
      setSnakeCollisionAllowed(joined.state.snakeCollisionAllowed);
      setFireEnabled(joined.state.fireEnabled);

      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("room", joined.roomId);
      window.history.replaceState({}, "", nextUrl);
    },
    [clearError, hidePopup, playerColorInput, playerNameInput]
  );

  useEffect(() => {
    biteAudioRef.current = new Audio("/sounds/bite.wav");
    biteAudioRef.current.preload = "auto";
    hitAudioRef.current = new Audio("/sounds/hit.wav");
    hitAudioRef.current.preload = "auto";
    victoryAudioRef.current = new Audio("/sounds/victory.wav");
    victoryAudioRef.current.preload = "auto";
    beepAudioRef.current = new Audio("/sounds/beep.wav");
    beepAudioRef.current.preload = "auto";
    beepAudioRef.current.loop = true;
    powerUpAudioRef.current = new Audio("/sounds/power-up.wav");
    powerUpAudioRef.current.preload = "auto";
    return () => {
      biteAudioRef.current = null;
      hitAudioRef.current = null;
      if (beepAudioRef.current) {
        beepAudioRef.current.pause();
      }
      victoryAudioRef.current = null;
      beepAudioRef.current = null;
      powerUpAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetRoom = params.get("room");
    if (!targetRoom) {
      return;
    }
    setPlayMode("multiplayer");
    setPlayerColorInput(randomPresetColor());
    setPendingRoomId(String(targetRoom).trim().toUpperCase());
    setStatusText("Set your name and color, then join the room.");
  }, []);

  useEffect(() => {
    if (!state) {
      scoreRef.current = null;
      previousStatusRef.current = null;
      specialVisibleRef.current = false;
      const sound = beepAudioRef.current;
      if (sound) {
        sound.pause();
        sound.currentTime = 0;
      }
      return;
    }
    const previous = scoreRef.current;
    const current = {
      p1: state.players.p1.score,
      p2: state.players.p2.score
    };
    const gainedP1 = previous ? current.p1 - previous.p1 : 0;
    const gainedP2 = previous ? current.p2 - previous.p2 : 0;
    if (previous && (gainedP1 > 0 || gainedP2 > 0)) {
      const sound = gainedP1 >= 10 || gainedP2 >= 10 ? powerUpAudioRef.current : biteAudioRef.current;
      if (sound) {
        sound.currentTime = 0;
        sound.play().catch(() => {});
      }
    }
    if (previous && (current.p1 < previous.p1 || current.p2 < previous.p2)) {
      const sound = hitAudioRef.current;
      if (sound) {
        sound.currentTime = 0;
        sound.play().catch(() => {});
      }
    }
    scoreRef.current = current;
    if (state.status === "gameOver" && previousStatusRef.current !== "gameOver") {
      const beep = beepAudioRef.current;
      if (beep) {
        beep.pause();
        beep.currentTime = 0;
      }
      specialVisibleRef.current = false;
      const sound = victoryAudioRef.current;
      if (sound) {
        sound.currentTime = 0;
        sound.play().catch(() => {});
      }
      setResultPopup(getEndgameSummary(state, playMode, profiles));
    }
    if (state.status !== "gameOver" && previousStatusRef.current === "gameOver") {
      setResultPopup(null);
    }
    if (state.status === "gameOver") {
      previousStatusRef.current = state.status;
      return;
    }
    const hasSpecialVisible = state.foods.some((food) => food.kind === "special");
    if (hasSpecialVisible !== specialVisibleRef.current) {
      specialVisibleRef.current = hasSpecialVisible;
      const sound = beepAudioRef.current;
      if (sound) {
        if (hasSpecialVisible) {
          sound.currentTime = 0;
          sound.play().catch(() => {});
        } else {
          sound.pause();
          sound.currentTime = 0;
        }
      }
    }
    previousStatusRef.current = state.status;
  }, [state, playMode, profiles]);

  useEffect(() => {
    if (!roomId || !playerId) {
      return;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?roomId=${encodeURIComponent(roomId)}&playerId=${encodeURIComponent(playerId)}`);
    wsRef.current = ws;
    wsIntentionalCloseRef.current = false;
    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data) as
          | {
            type: "state";
            state: GameState;
            roomId: string;
            playersJoined: number;
            profiles: Record<"p1" | "p2", { name: string; color: string }>;
          }
        | { type: "fired" }
        | { type: "error"; error: string };
      if (payload.type === "fired") {
        const sound = hitAudioRef.current;
        if (sound) {
          sound.currentTime = 0;
          sound.play().catch(() => {});
        }
        return;
      }
      if (payload.type === "error") {
        showError(payload.error);
        return;
      }
      setState(payload.state);
      setPlayersJoined(payload.playersJoined);
      setInviteUrl(buildInviteUrl(payload.roomId || roomId));
      setProfiles(payload.profiles);
    };
    ws.onerror = () => {
      ws.close();
    };
    ws.onclose = () => {
      wsRef.current = null;
      if (wsIntentionalCloseRef.current) {
        wsIntentionalCloseRef.current = false;
        return;
      }
      setRoomId("");
      setPlayerId("");
      setState(null);
      setPlayersJoined(0);
      setInviteUrl("#");
      setStatusText("Session ended. A player left the room.");
      showError("Room closed because a player disconnected.");
    };
    return () => {
      wsIntentionalCloseRef.current = true;
      wsRef.current = null;
      ws.close();
    };
  }, [roomId, playerId, showError]);

  useEffect(() => {
    if (!state) {
      return;
    }
    setDurationInput(state.durationSeconds);
    if (state.scoreLimit) {
      setScoreLimitInput(state.scoreLimit);
    }
    if (playMode === "solo" && !roomId) {
      setStatusText(state.status === "gameOver" ? "Run complete" : `Solo score: ${state.players.p1.score}`);
    } else if (state.status === "waiting") {
      setStatusText("Waiting for second player...");
    } else if (state.status === "gameOver") {
      setStatusText("Match complete");
    } else if (state.winCondition === "score") {
      setStatusText(`First to ${state.scoreLimit ?? "-"} points`);
    } else {
      setStatusText("Running");
    }
  }, [state, playMode, roomId]);

  const sendMultiplayerTarget = useCallback(
    (dx: number, dy: number) => {
      if (!roomId || !playerId || !wsRef.current) {
        return;
      }
      const magnitude = Math.hypot(dx, dy);
      if (magnitude < 4) {
        return;
      }
      const targetX = dx / magnitude;
      const targetY = dy / magnitude;
      const key = `${targetX.toFixed(3)}:${targetY.toFixed(3)}`;
      if (key === lastTargetRef.current) {
        return;
      }
      lastTargetRef.current = key;
      wsRef.current.send(JSON.stringify({ type: "input", targetX, targetY }));
    },
    [roomId, playerId]
  );

  const steerFromVector = useCallback(
    (dx: number, dy: number) => {
      if (playMode === "solo" && state?.solo) {
        setState((prev) => {
          if (!prev || !prev.solo) {
            return prev;
          }
          return {
            ...prev,
            solo: { ...prev.solo, targetX: dx, targetY: dy }
          };
        });
        return;
      }
      sendMultiplayerTarget(dx, dy);
    },
    [playMode, sendMultiplayerTarget, state?.solo]
  );

  const steerFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      if (!state || !boardRef.current) {
        return;
      }
      const boardRect = boardRef.current.getBoundingClientRect();
      const controlledPlayer = playMode === "solo" ? "p1" : playerId;
      if (!controlledPlayer) {
        return;
      }
      const head = state.players[controlledPlayer].snake[0];
      if (!head) {
        return;
      }
      const cellW = boardRect.width / state.width;
      const cellH = boardRect.height / state.height;
      const headCenterX = boardRect.left + head.x * cellW;
      const headCenterY = boardRect.top + head.y * cellH;
      const dx = clientX - headCenterX;
      const dy = clientY - headCenterY;
      setPointerIndicator({
        x: ((clientX - boardRect.left) / boardRect.width) * 100,
        y: ((clientY - boardRect.top) / boardRect.height) * 100,
        angle: Math.atan2(dy, dx),
        visible: true
      });
      steerFromVector(dx, dy);
    },
    [state, playMode, playerId, steerFromVector]
  );

  useEffect(() => {
    if (playMode !== "solo" || roomId) {
      return;
    }
    const timer = setInterval(() => {
      setState((prev) => {
        if (!prev || prev.status !== "running") {
          return prev;
        }
        return stepSoloState(prev, soloNextDirectionRef.current);
      });
    }, SOLO_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [playMode, roomId]);

  const soloPath = useMemo(() => {
    if (!state || playMode !== "solo") {
      return "";
    }
    return buildSnakePath(state.players.p1.snake, state.width, state.height, false);
  }, [state, playMode]);

  const multiplayerPaths = useMemo(() => {
    if (!state || playMode === "solo") {
      return { p1: "", p2: "" };
    }
    return {
      p1: buildSnakePath(state.players.p1.snake, state.width, state.height, false),
      p2: buildSnakePath(state.players.p2.snake, state.width, state.height, false)
    };
  }, [state, playMode]);
  const showSecondPlayer = playMode !== "solo" && playersJoined >= 2 && Boolean(state?.players.p2.snake.length);

  const inMatch = Boolean(roomId && playerId && state);
  const canShowSoloSetup = playMode === "solo" && !state && !inMatch;

  return (
    <main className="app play-terminal">
      {!inMatch && playMode === "menu" ? (
        <section className="mode-grid terminal-mode-grid">
          <button
            type="button"
            className="mode-card"
            onClick={() => {
              setPlayMode("solo");
              setRoomId("");
              setPlayerId("");
              setInviteUrl("#");
              setState(null);
              setStatusText("Set the solo rules, then start.");
              clearError();
              setResultPopup(null);
              clearRoomQueryParam();
            }}
          >
            <span className="mode-title">Solo</span>
            <span className="mode-text">Single-player challenge.</span>
          </button>
          <button
            type="button"
            className="mode-card"
            onClick={() => {
              setPlayMode("multiplayer");
              setPlayerColorInput(randomPresetColor());
              setRoomId("");
              setPlayerId("");
              setInviteUrl("#");
              setState(null);
              setStatusText("Create a multiplayer room.");
              clearError();
              setResultPopup(null);
              clearRoomQueryParam();
            }}
          >
            <span className="mode-title">Multiplayer</span>
            <span className="mode-text">Create a room and play with a friend.</span>
          </button>
        </section>
      ) : null}

      {canShowSoloSetup ? (
        <section className="setup-panel terminal-setup-panel">
          <div className="setup-head">
            <p className="panel-label">Solo Setup</p>
          </div>

          <div className="setup-block setup-row setup-row-wide">
            <div className="toggle-group">
              <button
                type="button"
                className={soloSelfCollisionAllowed ? "active-option" : ""}
                onClick={() => setSoloSelfCollisionAllowed((prev) => !prev)}
              >
                Self Collision: {soloSelfCollisionAllowed ? "On" : "Off"}
              </button>
            </div>
          </div>

          <div className="setup-actions">
            <button type="button" className="btn-primary create-room-btn" onClick={startSoloGame}>
              Play
            </button>
          </div>
        </section>
      ) : null}

      {!inMatch && playMode === "multiplayer" ? (
        <section className="setup-panel terminal-setup-panel">
          <div className="setup-head">
            <p className="panel-label">{pendingRoomId ? `Join Room ${pendingRoomId}` : "Multiplayer Setup"}</p>
          </div>

          <div className="setup-block setup-row">
            <span className="setup-label">Name</span>
            <div className="input-row">
              <input
                id="player-name-input"
                type="text"
                maxLength={20}
                placeholder="Your name"
                value={playerNameInput}
                onChange={(event) => setPlayerNameInput(event.target.value)}
              />
            </div>
          </div>

          <div className="setup-block setup-row">
            <span className="setup-label">Snake Color</span>
            <div className="input-row color-row">
                  <input
                    id="player-color-input"
                    type="color"
                    value={playerColorInput}
                    onChange={(event) => setPlayerColorInput(event.target.value)}
                  />
                </div>
              </div>

          {pendingRoomId ? null : (
            <>
              <div className="setup-block setup-inline-group">
                <div className="toggle-group">
                  <button
                    type="button"
                    className={winCondition === "time" ? "active-option" : ""}
                    onClick={() => setWinCondition("time")}
                  >
                    Time Limit
                  </button>
                  <button
                    type="button"
                    className={winCondition === "score" ? "active-option" : ""}
                    onClick={() => setWinCondition("score")}
                  >
                    Score Limit
                  </button>
                </div>
                {winCondition === "time" ? (
                  <input
                    id="duration-input"
                    type="number"
                    min="10"
                    max="900"
                    step="10"
                    value={durationInput}
                    placeholder="Seconds"
                    onChange={(event) => setDurationInput(Number(event.target.value))}
                  />
                ) : (
                  <input
                    id="score-input"
                    type="number"
                    min="1"
                    max="200"
                    step="1"
                    value={scoreLimitInput}
                    placeholder="Score"
                    onChange={(event) => setScoreLimitInput(Number(event.target.value))}
                  />
                )}
              </div>

              <div className="setup-block setup-row setup-row-wide">
                <div className="toggle-group">
                  <button
                    type="button"
                    className={selfCollisionAllowed ? "active-option" : ""}
                    onClick={() => setSelfCollisionAllowed((prev) => !prev)}
                  >
                    Self Collision: {selfCollisionAllowed ? "On" : "Off"}
                  </button>
                  <button
                    type="button"
                    className={snakeCollisionAllowed ? "active-option" : ""}
                    onClick={() => setSnakeCollisionAllowed((prev) => !prev)}
                  >
                    Snake Collision: {snakeCollisionAllowed ? "On" : "Off"}
                  </button>
                </div>
              </div>

              <div className="setup-block setup-row setup-row-wide">
                <div className="toggle-group">
                  <button
                    type="button"
                    className={fireEnabled ? "active-option" : ""}
                    onClick={() => setFireEnabled((prev) => !prev)}
                  >
                    Fire: {fireEnabled ? "On" : "Off"}
                  </button>
                </div>
              </div>
            </>
          )}

          <div className="setup-actions">
            <button
              type="button"
              className="btn-primary create-room-btn"
              onClick={async () => {
                try {
                  if (pendingRoomId) {
                    await joinRoom(pendingRoomId);
                    setResultPopup(null);
                    return;
                  }
                  const created = await api<{ roomId: string }>("/api/create-room", "POST", {
                    winCondition,
                    durationSeconds: Number(durationInput),
                    scoreLimit: Number(scoreLimitInput),
                    selfCollisionAllowed,
                    snakeCollisionAllowed,
                    fireEnabled
                  });
                  await joinRoom(created.roomId);
                  setResultPopup(null);
                } catch (error) {
                  const typed = error as Error & { status?: number };
                  if (typed?.status === 409) {
                    showPopup("This room is already full. Ask the host to create a new room.");
                  } else {
                    showError(friendlyErrorMessage(error));
                  }
                }
              }}
            >
              {pendingRoomId ? "Join Room" : "Create Room"}
            </button>
          </div>

          <p className="error-msg" role="alert" aria-live="polite">
            {errorText}
          </p>
        </section>
      ) : null}

      {inMatch || (playMode === "solo" && state) ? (
          <section className="game-layout">
          <section className="board-shell terminal-board-shell">
            <section
              ref={boardRef}
              className={`board ${playMode === "solo" ? "solo-board" : ""}`}
              aria-label="Snake board"
              onContextMenu={(event) => {
                event.preventDefault();
              }}
              onPointerDown={(event) => {
                if (event.button === 2) {
                  event.preventDefault();
                  fireMultiplayerShot();
                  return;
                }
                steerFromPointer(event.clientX, event.clientY);
              }}
              onPointerMove={(event) => {
                steerFromPointer(event.clientX, event.clientY);
              }}
              onPointerLeave={() => {
                setPointerIndicator((prev) => ({ ...prev, visible: false }));
              }}
            >
              {state ? (
                <svg className="solo-canvas" viewBox={`0 0 ${state.width} ${state.height}`} preserveAspectRatio="none">
                  {playMode !== "solo" ? (
                    <>
                      {renderWrappedPathCopies(multiplayerPaths.p1, state.width, state.height, (key, transform) => (
                        <path key={`p1-glow-${key}`} d={multiplayerPaths.p1} transform={transform} className="multi-snake-glow p1" style={{ stroke: profiles.p1.color }} />
                      ))}
                      {showSecondPlayer
                        ? renderWrappedPathCopies(multiplayerPaths.p2, state.width, state.height, (key, transform) => (
                            <path key={`p2-glow-${key}`} d={multiplayerPaths.p2} transform={transform} className="multi-snake-glow p2" style={{ stroke: profiles.p2.color }} />
                          ))
                        : null}
                      {renderWrappedPathCopies(multiplayerPaths.p1, state.width, state.height, (key, transform) => (
                        <path key={`p1-body-${key}`} d={multiplayerPaths.p1} transform={transform} className="multi-snake-path p1" style={{ stroke: profiles.p1.color }} />
                      ))}
                      {renderWrappedPathCopies(multiplayerPaths.p1, state.width, state.height, (key, transform) => (
                        <path key={`p1-accent-${key}`} d={multiplayerPaths.p1} transform={transform} className="multi-snake-accent p1" />
                      ))}
                      {showSecondPlayer
                        ? renderWrappedPathCopies(multiplayerPaths.p2, state.width, state.height, (key, transform) => (
                            <path key={`p2-body-${key}`} d={multiplayerPaths.p2} transform={transform} className="multi-snake-path p2" style={{ stroke: profiles.p2.color }} />
                          ))
                        : null}
                      {showSecondPlayer
                        ? renderWrappedPathCopies(multiplayerPaths.p2, state.width, state.height, (key, transform) => (
                            <path key={`p2-accent-${key}`} d={multiplayerPaths.p2} transform={transform} className="multi-snake-accent p2" />
                          ))
                        : null}
                      {renderSnakeHead(state.players.p1.snake[0], headingToAngle(state.players.p1.heading), "p1", profiles.p1.color)}
                      {showSecondPlayer
                        ? renderSnakeHead(state.players.p2.snake[0], headingToAngle(state.players.p2.heading, "left"), "p2", profiles.p2.color)
                        : null}
                      {state.players.p1.snake[0] ? (
                        <text x={state.players.p1.snake[0].x} y={state.players.p1.snake[0].y - 3.6} className="snake-name-label">
                          {profiles.p1.name}
                        </text>
                      ) : null}
                      {showSecondPlayer && state.players.p2.snake[0] ? (
                        <text x={state.players.p2.snake[0].x} y={state.players.p2.snake[0].y - 3.6} className="snake-name-label">
                          {profiles.p2.name}
                        </text>
                      ) : null}
                    </>
                  ) : null}
                  {playMode === "solo" ? (
                    <>
                      {renderWrappedPathCopies(soloPath, state.width, state.height, (key, transform) => (
                        <path key={`solo-glow-${key}`} d={soloPath} transform={transform} className="solo-snake-glow" />
                      ))}
                      {renderWrappedPathCopies(soloPath, state.width, state.height, (key, transform) => (
                        <path key={`solo-body-${key}`} d={soloPath} transform={transform} className="solo-snake-path" />
                      ))}
                      {renderWrappedPathCopies(soloPath, state.width, state.height, (key, transform) => (
                        <path key={`solo-accent-${key}`} d={soloPath} transform={transform} className="solo-snake-accent" />
                      ))}
                      {renderSnakeHead(state.players.p1.snake[0], headingToAngle(state.players.p1.heading, state.players.p1.direction ?? "right"), "solo")}
                    </>
                  ) : null}
                  {state.foods.map((food, idx) => renderFood(food, `${playMode}-${idx}`, playMode === "solo"))}
                  {playMode !== "solo"
                    ? state.bullets.map((bullet) => (
                        <g
                          key={bullet.id}
                          transform={`translate(${bullet.x} ${bullet.y}) rotate(${(Math.atan2(bullet.vy, bullet.vx) * 180) / Math.PI})`}
                        >
                          <path
                            className="bullet-shape"
                            style={{
                              fill: bullet.ownerId === "p1" ? profiles.p1.color : profiles.p2.color,
                              stroke: bullet.ownerId === "p1" ? profiles.p1.color : profiles.p2.color
                            }}
                            d="M-0.7 -0.16 L0.72 0 L-0.7 0.16 L-0.24 0 Z"
                          />
                        </g>
                      ))
                    : null}
                    {playMode !== "solo"
                      ? (state.impacts ?? []).map((impact) => (
                        <g key={impact.id} transform={`translate(${impact.x} ${impact.y})`} className="hit-burst">
                          <circle
                            className="hit-burst-ring"
                            r="0.8"
                            style={{ stroke: impact.ownerId === "p1" ? profiles.p1.color : profiles.p2.color }}
                          >
                            <animate attributeName="r" from="0.8" to="3.2" dur="0.26s" fill="freeze" />
                            <animate attributeName="opacity" from="0.95" to="0" dur="0.26s" fill="freeze" />
                          </circle>
                          <circle
                            className="hit-burst-core"
                            r="0.5"
                            style={{
                              fill: impact.ownerId === "p1" ? profiles.p1.color : profiles.p2.color,
                              color: impact.ownerId === "p1" ? profiles.p1.color : profiles.p2.color
                            }}
                          >
                            <animate attributeName="r" from="0.5" to="0.08" dur="0.26s" fill="freeze" />
                            <animate attributeName="opacity" from="0.95" to="0" dur="0.26s" fill="freeze" />
                          </circle>
                        </g>
                      ))
                    : null}
                </svg>
              ) : null}
              <div
                className={`pointer-indicator-big ${pointerIndicator.visible ? "visible" : ""}`}
                style={{
                  left: `${pointerIndicator.x}%`,
                  top: `${pointerIndicator.y}%`,
                  transform: `translate(-50%, -50%) rotate(${pointerIndicator.angle}rad)`
                }}
              />
              <div
                className={`mobile-joystick ${joystickState.active ? "active" : ""}`}
                onTouchStart={(event) => {
                  const touch = event.touches[0];
                  const rect = event.currentTarget.getBoundingClientRect();
                  const dx = touch.clientX - (rect.left + rect.width / 2);
                  const dy = touch.clientY - (rect.top + rect.height / 2);
                  const size = Math.hypot(dx, dy) || 1;
                  const limited = Math.min(32, size);
                  setJoystickState({
                    active: true,
                    x: (dx / size) * limited,
                    y: (dy / size) * limited
                  });
                  steerFromVector(dx, dy);
                }}
                onTouchMove={(event) => {
                  event.preventDefault();
                  const touch = event.touches[0];
                  const rect = event.currentTarget.getBoundingClientRect();
                  const dx = touch.clientX - (rect.left + rect.width / 2);
                  const dy = touch.clientY - (rect.top + rect.height / 2);
                  const size = Math.hypot(dx, dy) || 1;
                  const limited = Math.min(32, size);
                  setJoystickState({
                    active: true,
                    x: (dx / size) * limited,
                    y: (dy / size) * limited
                  });
                  steerFromVector(dx, dy);
                }}
                onTouchEnd={() => {
                  setJoystickState({ active: false, x: 0, y: 0 });
                }}
              >
                <div className="mobile-joystick-base" />
                <div
                  className="mobile-joystick-knob"
                  style={{ transform: `translate(calc(-50% + ${joystickState.x}px), calc(-50% + ${joystickState.y}px))` }}
                />
              </div>
            </section>
          </section>

          <aside className="game-sidebar terminal-game-sidebar">
            <section className={`match-panel terminal-match-panel ${playMode === "solo" ? "solo-panel" : "multi-panel"}`}>
              <div className="panel-head">
                <div>
                  <p className="panel-label">{playMode === "solo" ? "Solo Run" : `Room ${roomId}`}</p>
                  <p className="panel-status">{statusText}</p>
                </div>
                <div className="hud-actions">
                  {playMode === "solo" ? (
                    <>
                      <button
                        type="button"
                        onClick={startSoloGame}
                      >
                        Restart
                      </button>
                      <button
                        type="button"
                        onClick={resetToMenu}
                      >
                        Modes
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={resetToMenu}
                      >
                        Modes
                      </button>
                      <button
                        id="copy-link-btn"
                        type="button"
                        onClick={async () => {
                          if (!inviteUrl || inviteUrl === "#") {
                            showError("Create or join a room first.");
                            return;
                          }
                          try {
                            await copyText(inviteUrl);
                            clearError();
                            setCopyInviteLabel("Copied!");
                            window.setTimeout(() => {
                              setCopyInviteLabel("Copy Invite");
                            }, 1200);
                          } catch {
                            showError("Could not copy automatically. Copy the link manually.");
                          }
                        }}
                      >
                        {copyInviteLabel}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!roomId || !playerId) {
                            return;
                          }
                          api("/api/restart", "POST", { roomId, playerId }).catch((error) => {
                            showError(friendlyErrorMessage(error));
                          });
                          setResultPopup(null);
                        }}
                      >
                        Restart
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="hud-grid">
                {playMode === "solo" ? (
                  <div className="stat-chip">
                    <span className="stat-label">Score</span>
                    <strong>{state?.players?.p1?.score ?? 0}</strong>
                  </div>
                ) : (
                  <>
                    <div className="stat-chip">
                      <span className="stat-label">P1</span>
                      <strong>{state?.players?.p1?.score ?? 0}</strong>
                    </div>
                    {showSecondPlayer ? (
                      <div className="stat-chip">
                        <span className="stat-label">P2</span>
                        <strong>{state?.players?.p2?.score ?? 0}</strong>
                      </div>
                    ) : (
                      <div className="stat-chip">
                        <span className="stat-label">Room</span>
                        <strong>Waiting</strong>
                      </div>
                    )}
                    <div className="stat-chip">
                      <span className="stat-label">Role</span>
                      <strong>{playerId ? playerId.toUpperCase() : "-"}</strong>
                    </div>
                    <div className="stat-chip">
                      <span className="stat-label">{state?.winCondition === "time" ? "Time" : "Target"}</span>
                      <strong>
                        {state?.winCondition === "time"
                          ? `${Math.ceil((state?.remainingMs ?? 120000) / 1000)}s`
                          : state?.scoreLimit ?? "-"}
                      </strong>
                    </div>
                  </>
                )}
              </div>

              <div className="rule-row">
                <span className="rule-chip">
                  {state?.winCondition === "time" ? `Time Limit ${state?.durationSeconds}s` : `Score Limit ${state?.scoreLimit ?? "-"}`}
                </span>
                <span className="rule-chip">Self Collision {state?.selfCollisionAllowed ? "On" : "Off"}</span>
                {playMode === "solo" ? null : (
                  <>
                    <span className="rule-chip">Snake Collision {state?.snakeCollisionAllowed ? "On" : "Off"}</span>
                    <span className="rule-chip">Fire {state?.fireEnabled ? "On" : "Off"}</span>
                  </>
                )}
              </div>

              {playMode === "solo" ? null : (
                <div className="invite-inline">
                  <span className="stat-label">Invite</span>
                  <a href={inviteUrl}>{inviteUrl === "#" ? "-" : inviteUrl}</a>
                </div>
              )}

              <p className="error-msg" role="alert" aria-live="polite">
                {errorText}
              </p>
            </section>
          </aside>
        </section>
      ) : null}

      <section
        className={`popup-overlay ${popupText ? "" : "hidden"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="popup-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            hidePopup();
          }
        }}
      >
        <div className="popup-card">
          <h2 id="popup-title">Room Full</h2>
          <p>{popupText || "This room already has two players."}</p>
          <button type="button" onClick={hidePopup}>
            OK
          </button>
        </div>
      </section>

      <section
        className={`popup-overlay ${resultPopup ? "" : "hidden"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-popup-title"
      >
          <div className="popup-card result-popup-card">
            <h2 id="result-popup-title">{resultPopup?.title || "Game Over"}</h2>
            <p>{resultPopup?.body || ""}</p>
            {resultPopup?.detail ? <p className="result-popup-detail">{resultPopup.detail}</p> : null}
            <button
            type="button"
            onClick={() => {
              if (playMode === "solo") {
                startSoloGame();
                return;
              }
              if (!roomId || !playerId) {
                return;
              }
              api("/api/restart", "POST", { roomId, playerId }).catch((error) => {
                showError(friendlyErrorMessage(error));
              });
              setResultPopup(null);
            }}
          >
            Restart
          </button>
        </div>
      </section>
    </main>
  );
}
