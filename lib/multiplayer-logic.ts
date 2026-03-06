const PLAYER_IDS = ["p1", "p2"] as const;

type PlayerId = (typeof PLAYER_IDS)[number];
type Point = { x: number; y: number };
type Vector = { x: number; y: number };

type Food = Point & {
  variant: number;
  kind: "normal" | "special";
  points: number;
  ttlMs: number | null;
};

type Bullet = Point & {
  id: string;
  vx: number;
  vy: number;
  ownerId: PlayerId;
  ttlMs: number;
};

type Impact = Point & {
  id: string;
  ownerId: PlayerId;
  ttlMs: number;
};

type Player = {
  id: PlayerId;
  snake: Point[];
  heading: Vector;
  target: Vector;
  score: number;
  lastShotAt: number;
  length: number;
};

type Players = Record<PlayerId, Player>;

type RoomState = {
  width: number;
  height: number;
  durationSeconds: number;
  remainingMs: number;
  winCondition: "time" | "score";
  scoreLimit: number | null;
  selfCollisionAllowed: boolean;
  snakeCollisionAllowed: boolean;
  fireEnabled: boolean;
  foods: Food[];
  bullets: Bullet[];
  impacts: Impact[];
  foodsCollected: number;
  nextSpecialFoodAt: number;
  status: "waiting" | "running" | "gameOver";
  winner: PlayerId | null;
  players: Players;
};

type Rng = () => number;

type CreateRoomOptions = {
  winCondition?: "time" | "score";
  scoreLimit?: number | null;
  selfCollisionAllowed?: boolean;
  snakeCollisionAllowed?: boolean;
  fireEnabled?: boolean;
};

export const MAX_FOODS = 4;
const FIRE_COOLDOWN_MS = 200;
const SPECIAL_FOOD_INTERVAL = 5;
const SPECIAL_FOOD_LIFETIME_MS = 8000;
const NORMAL_GROWTH = 5;
const SPECIAL_GROWTH = 10;
const SNAKE_SPEED = 24;
const BULLET_SPEED = 62;
const BULLET_TTL_MS = 2200;
const IMPACT_TTL_MS = 260;
const FOOD_EAT_RADIUS = 3.3;
const SELF_COLLISION_RADIUS = 1.65;
const SNAKE_COLLISION_RADIUS = 1.8;
const FOOD_MARGIN = 6;
const SPECIAL_FOOD_MARGIN = 12;

function normalizeVector(vector: Vector, fallback: Vector = { x: 1, y: 0 }): Vector {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(magnitude) || magnitude < 0.0001) {
    return { ...fallback };
  }
  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude
  };
}

function wrapPoint(point: Point, width: number, height: number): Point {
  return {
    x: point.x < 0 ? width + point.x : point.x >= width ? point.x - width : point.x,
    y: point.y < 0 ? height + point.y : point.y >= height ? point.y - height : point.y
  };
}

function randomFoodVariant(rng: Rng): number {
  return Math.floor(rng() * 4);
}

function createFood(point: Point, rng: Rng, kind: "normal" | "special" = "normal"): Food {
  return {
    x: point.x,
    y: point.y,
    variant: randomFoodVariant(rng),
    kind,
    points: kind === "special" ? 10 : 1,
    ttlMs: kind === "special" ? SPECIAL_FOOD_LIFETIME_MS : null
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.000001) {
    return distance(point, start);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return distance(point, {
    x: start.x + dx * t,
    y: start.y + dy * t
  });
}

function trimSnakeLength(points: Point[], maxLength: number): Point[] {
  if (!points.length) {
    return points;
  }
  const out = [{ ...points[0] }];
  let used = 0;
  for (let index = 1; index < points.length; index += 1) {
    const prev = out[out.length - 1];
    const next = points[index];
    const segmentLength = distance(prev, next);
    if (used + segmentLength <= maxLength) {
      out.push({ ...next });
      used += segmentLength;
      continue;
    }
    const remain = Math.max(0, maxLength - used);
    if (segmentLength > 0 && remain > 0) {
      const ratio = remain / segmentLength;
      out.push({
        x: prev.x + (next.x - prev.x) * ratio,
        y: prev.y + (next.y - prev.y) * ratio
      });
    }
    break;
  }
  return out;
}

function clonePlayer(player: Player): Player {
  return {
    ...player,
    heading: { ...player.heading },
    target: { ...player.target },
    snake: player.snake.map((segment) => ({ ...segment }))
  };
}

function createPlayer(id: PlayerId, head: Point, heading: Vector): Player {
  const normalizedHeading = normalizeVector(heading);
  const baseLength = 11;
  const snake = Array.from({ length: 8 }, (_, index) => ({
    x: head.x - normalizedHeading.x * index * 1.4,
    y: head.y - normalizedHeading.y * index * 1.4
  }));
  return {
    id,
    snake,
    heading: normalizedHeading,
    target: normalizedHeading,
    score: 0,
    lastShotAt: 0,
    length: baseLength
  };
}

function decideWinner(players: Players): PlayerId | null {
  if (players.p1.score > players.p2.score) {
    return "p1";
  }
  if (players.p2.score > players.p1.score) {
    return "p2";
  }
  return null;
}

function winnerFromLoser(loser: PlayerId | null): PlayerId | null {
  if (loser === "p1") {
    return "p2";
  }
  if (loser === "p2") {
    return "p1";
  }
  return null;
}

function isPointClear(
  point: Point,
  players: Players,
  foods: Food[],
  minDistance: number,
  edgeMargin: number,
  width: number,
  height: number
): boolean {
  if (
    point.x < edgeMargin ||
    point.y < edgeMargin ||
    point.x > width - edgeMargin ||
    point.y > height - edgeMargin
  ) {
    return false;
  }
  for (const player of Object.values(players)) {
    if (player.snake.some((segment) => distance(segment, point) < minDistance)) {
      return false;
    }
  }
  if (foods.some((food) => distance(food, point) < minDistance)) {
    return false;
  }
  return true;
}

function randomOpenPoint(
  width: number,
  height: number,
  players: Players,
  foods: Food[],
  rng: Rng,
  edgeMargin: number,
  minDistance: number
): Point | null {
  for (let index = 0; index < 120; index += 1) {
    const point = {
      x: edgeMargin + rng() * Math.max(1, width - edgeMargin * 2),
      y: edgeMargin + rng() * Math.max(1, height - edgeMargin * 2)
    };
    if (isPointClear(point, players, foods, minDistance, edgeMargin, width, height)) {
      return point;
    }
  }
  return null;
}

export function placeFood(width: number, height: number, players: Players, foods: Food[] = [], rng: Rng = Math.random): Food | null {
  const point = randomOpenPoint(width, height, players, foods, rng, FOOD_MARGIN, 6);
  return point ? createFood(point, rng, "normal") : null;
}

function placeSpecialFood(width: number, height: number, players: Players, foods: Food[] = [], rng: Rng = Math.random): Food | null {
  const point = randomOpenPoint(width, height, players, foods, rng, SPECIAL_FOOD_MARGIN, 10);
  return point ? createFood(point, rng, "special") : null;
}

export function seedFoods(width: number, height: number, players: Players, maxFoods = MAX_FOODS, rng: Rng = Math.random): Food[] {
  const foods: Food[] = [];
  while (foods.length < maxFoods) {
    const nextFood = placeFood(width, height, players, foods, rng);
    if (!nextFood) {
      break;
    }
    foods.push(nextFood);
  }
  return foods;
}

export function createRoomState(
  width = 100,
  height = 100,
  durationSeconds = 120,
  rng: Rng = Math.random,
  options: CreateRoomOptions = {}
): RoomState {
  const winCondition = options.winCondition === "score" ? "score" : "time";
  const scoreLimit =
    winCondition === "score"
      ? Math.max(1, Math.min(200, Math.floor(Number(options.scoreLimit) || 5)))
      : null;
  const players: Players = {
    p1: createPlayer("p1", { x: 24, y: height / 2 }, { x: 1, y: 0 }),
    p2: createPlayer("p2", { x: width - 24, y: height / 2 }, { x: -1, y: 0 })
  };

  return {
    width,
    height,
    durationSeconds,
    remainingMs: winCondition === "time" ? durationSeconds * 1000 : 0,
    winCondition,
    scoreLimit,
    selfCollisionAllowed: Boolean(options.selfCollisionAllowed),
    snakeCollisionAllowed: Boolean(options.snakeCollisionAllowed),
    fireEnabled: Boolean(options.fireEnabled),
    foods: seedFoods(width, height, players, MAX_FOODS, rng),
    bullets: [],
    impacts: [],
    foodsCollected: 0,
    nextSpecialFoodAt: SPECIAL_FOOD_INTERVAL,
    status: "waiting",
    winner: null,
    players
  };
}

export function setDuration(state: RoomState, durationSeconds: number): RoomState {
  const clampedSeconds = Math.max(10, Math.min(900, Math.floor(Number(durationSeconds) || 0)));
  if (state.status === "running" || state.winCondition !== "time") {
    return state;
  }
  return {
    ...state,
    durationSeconds: clampedSeconds,
    remainingMs: clampedSeconds * 1000
  };
}

export function setPlayerTarget(state: RoomState, playerId: string, x: number, y: number): RoomState {
  if ((playerId !== "p1" && playerId !== "p2") || !Number.isFinite(x) || !Number.isFinite(y)) {
    return state;
  }
  const typedPlayerId = playerId as PlayerId;
  const player = state.players[typedPlayerId];
  const target = normalizeVector({ x, y }, player.heading);
  return {
    ...state,
    players: {
      ...state.players,
      [typedPlayerId]: {
        ...player,
        target
      }
    }
  };
}

export function fireBullet(state: RoomState, playerId: string, nowMs = Date.now()): RoomState {
  if ((playerId !== "p1" && playerId !== "p2") || !state.fireEnabled || state.status !== "running") {
    return state;
  }

  const typedPlayerId = playerId as PlayerId;
  const player = state.players[typedPlayerId];
  if (nowMs - player.lastShotAt < FIRE_COOLDOWN_MS) {
    return state;
  }

  const heading = normalizeVector(player.heading, { x: 1, y: 0 });
  const head = player.snake[0];
  const spawn = wrapPoint({ x: head.x + heading.x * 2.6, y: head.y + heading.y * 2.6 }, state.width, state.height);

  return {
    ...state,
    bullets: [
      ...state.bullets,
      {
        id: `${typedPlayerId}-${nowMs}-${state.bullets.length}`,
        x: spawn.x,
        y: spawn.y,
        vx: heading.x * BULLET_SPEED,
        vy: heading.y * BULLET_SPEED,
        ownerId: typedPlayerId,
        ttlMs: BULLET_TTL_MS
      }
    ],
    players: {
      ...state.players,
      [typedPlayerId]: {
        ...player,
        lastShotAt: nowMs
      }
    }
  };
}

function updatePlayer(player: Player, foods: Food[], tickMs: number, width: number, height: number) {
  const dt = tickMs / 1000;
  const heading = normalizeVector(player.target, player.heading);
  const head = player.snake[0];
  const nextHead = wrapPoint(
    {
      x: head.x + heading.x * SNAKE_SPEED * dt,
      y: head.y + heading.y * SNAKE_SPEED * dt
    },
    width,
    height
  );
  const eatenIndex = foods.findIndex((food) => distance(food, nextHead) < FOOD_EAT_RADIUS);
  const eatenFood = eatenIndex >= 0 ? foods[eatenIndex] : null;
  const nextLength = player.length + (eatenFood ? (eatenFood.kind === "special" ? SPECIAL_GROWTH : NORMAL_GROWTH) : 0);
  const nextSnake = trimSnakeLength([nextHead, ...player.snake], nextLength);
  return {
    player: {
      ...player,
      heading,
      target: heading,
      length: nextLength,
      snake: nextSnake,
      score: player.score + (eatenFood ? eatenFood.points : 0)
    },
    eatenFood,
    eatenIndex
  };
}

function bodyCollision(head: Point, body: Point[], threshold: number, skip = 0): boolean {
  for (let index = skip; index < body.length; index += 1) {
    if (distance(head, body[index]) < threshold) {
      return true;
    }
  }
  return false;
}

export function tickRoom(state: RoomState, tickMs = 80, rng: Rng = Math.random): RoomState {
  if (state.status !== "running") {
    return state;
  }

  let foods = state.foods
    .map((food) => ({
      ...food,
      ttlMs: food.kind === "special" ? Math.max(0, (food.ttlMs ?? SPECIAL_FOOD_LIFETIME_MS) - tickMs) : null
    }))
    .filter((food) => food.kind !== "special" || (food.ttlMs ?? 0) > 0);
  const players: Players = {
    p1: clonePlayer(state.players.p1),
    p2: clonePlayer(state.players.p2)
  };
  const impacts = state.impacts
    .map((impact) => ({ ...impact, ttlMs: impact.ttlMs - tickMs }))
    .filter((impact) => impact.ttlMs > 0);
  let foodsCollected = state.foodsCollected;

  for (const playerId of PLAYER_IDS) {
    const result = updatePlayer(players[playerId], foods, tickMs, state.width, state.height);
    players[playerId] = result.player;
    if (result.eatenIndex >= 0 && result.eatenFood) {
      foods.splice(result.eatenIndex, 1);
      if (result.eatenFood.kind === "normal") {
        foodsCollected += 1;
      }
    }
  }

  let selfCollisionFinished = false;
  let selfCollisionLoser: PlayerId | null = null;
  if (state.selfCollisionAllowed) {
    const p1SelfHit = bodyCollision(players.p1.snake[0], players.p1.snake, SELF_COLLISION_RADIUS, 8);
    const p2SelfHit = bodyCollision(players.p2.snake[0], players.p2.snake, SELF_COLLISION_RADIUS, 8);
    selfCollisionFinished = p1SelfHit || p2SelfHit;
    selfCollisionLoser = p1SelfHit && p2SelfHit ? null : p1SelfHit ? "p1" : p2SelfHit ? "p2" : null;
  }

  let snakeCollisionFinished = false;
  let snakeCollisionLoser: PlayerId | null = null;
  if (state.snakeCollisionAllowed) {
    const p1HitsP2 = bodyCollision(players.p1.snake[0], players.p2.snake, SNAKE_COLLISION_RADIUS, 0);
    const p2HitsP1 = bodyCollision(players.p2.snake[0], players.p1.snake, SNAKE_COLLISION_RADIUS, 0);
    snakeCollisionFinished = p1HitsP2 || p2HitsP1;
    snakeCollisionLoser = p1HitsP2 && p2HitsP1 ? null : p1HitsP2 ? "p1" : p2HitsP1 ? "p2" : null;
  }

  const bullets: Bullet[] = [];
  const dt = tickMs / 1000;
  for (const bullet of state.bullets) {
    const startPoint = { x: bullet.x, y: bullet.y };
    const nextPosition = {
      x: bullet.x + bullet.vx * dt,
      y: bullet.y + bullet.vy * dt
    };
    if (nextPosition.x < 0 || nextPosition.y < 0 || nextPosition.x > state.width || nextPosition.y > state.height) {
      continue;
    }
    const nextBullet = {
      ...bullet,
      ttlMs: bullet.ttlMs - tickMs,
      ...nextPosition
    };
    if (nextBullet.ttlMs <= 0) {
      continue;
    }
    const targetId: PlayerId = bullet.ownerId === "p1" ? "p2" : "p1";
    const hitTarget = players[targetId].snake.some(
      (segment, index) => index > 2 && distanceToSegment(segment, startPoint, nextPosition) < 1.65
    );
    if (hitTarget) {
      players[targetId].score = Math.max(0, players[targetId].score - 1);
      impacts.push({
        id: `impact-${bullet.id}`,
        x: nextPosition.x,
        y: nextPosition.y,
        ownerId: bullet.ownerId,
        ttlMs: IMPACT_TTL_MS
      });
      continue;
    }
    bullets.push(nextBullet);
  }

  let nextSpecialFoodAt = state.nextSpecialFoodAt;
  const hasSpecialFood = foods.some((food) => food.kind === "special");
  if (foodsCollected >= nextSpecialFoodAt && !hasSpecialFood) {
    const specialFood = placeSpecialFood(state.width, state.height, players, foods, rng);
    if (specialFood) {
      foods.push(specialFood);
      nextSpecialFoodAt += SPECIAL_FOOD_INTERVAL;
    }
  }

  while (foods.length < MAX_FOODS) {
    const nextFood = placeFood(state.width, state.height, players, foods, rng);
    if (!nextFood) {
      break;
    }
    foods.push(nextFood);
  }

  const remainingMs = state.winCondition === "time" ? Math.max(0, state.remainingMs - tickMs) : state.remainingMs;
  const timerFinished = state.winCondition === "time" && remainingMs === 0;
  const scoreFinished =
    state.winCondition === "score" &&
    state.scoreLimit !== null &&
    (players.p1.score >= state.scoreLimit || players.p2.score >= state.scoreLimit);
  const finished = timerFinished || scoreFinished || selfCollisionFinished || snakeCollisionFinished;
  const collisionWinner =
    winnerFromLoser(selfCollisionLoser) ?? winnerFromLoser(snakeCollisionLoser);

  return {
    ...state,
    remainingMs,
    foods,
    bullets,
    impacts,
    foodsCollected,
    nextSpecialFoodAt,
    players,
    status: finished ? "gameOver" : "running",
    winner: finished ? collisionWinner ?? decideWinner(players) : null
  };
}

export function restartRoom(state: RoomState, rng: Rng = Math.random): RoomState {
  const fresh = createRoomState(state.width, state.height, state.durationSeconds, rng, {
    winCondition: state.winCondition,
    scoreLimit: state.scoreLimit,
    selfCollisionAllowed: state.selfCollisionAllowed,
    snakeCollisionAllowed: state.snakeCollisionAllowed,
    fireEnabled: state.fireEnabled
  });
  return {
    ...fresh,
    status: state.status === "running" || state.status === "gameOver" ? "running" : "waiting"
  };
}
