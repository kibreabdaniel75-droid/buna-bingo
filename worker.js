
async function verifyTelegram(initData, botToken) {
  if (typeof initData !== "string" || !botToken) return null;

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) return null;

  params.delete("hash");

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);

  if (!authDate || authDate > now + 60 || now - authDate > 86400) {
    return null;
  }

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const encoder = new TextEncoder();

  async function hmac(keyBytes, message) {
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    return new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(message))
    );
  }

  const secretKey = await hmac(
    encoder.encode("WebAppData"),
    botToken
  );

  const calculatedHash = [...await hmac(
    secretKey,
    dataCheckString
  )].map(b => b.toString(16).padStart(2, "0")).join("");

  if (calculatedHash.length !== receivedHash.length) return null;

  let difference = 0;

  for (let i = 0; i < calculatedHash.length; i++) {
    difference |= calculatedHash.charCodeAt(i) ^ receivedHash.charCodeAt(i);
  }

  if (difference !== 0) return null;

  try {
    return JSON.parse(params.get("user"));
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Telegram authentication
    if (
      url.pathname === "/api/auth/telegram" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const user = await verifyTelegram(
          body.initData,
          env.BOT_TOKEN
        );

        if (!user || !user.id) {
          return Response.json(
            {
              success: false,
              error: "Invalid Telegram authentication"
            },
            { status: 401 }
          );
        }

        const telegramId = String(user.id);
        const playerId = crypto.randomUUID();

        await env.DB.prepare(`
          INSERT INTO players (id, telegram_id, username)
          VALUES (?, ?, ?)
          ON CONFLICT(telegram_id)
          DO UPDATE SET username = excluded.username
        `).bind(
          playerId,
          telegramId,
          user.username || null
        ).run();

        const player = await env.DB.prepare(`
          SELECT id, telegram_id, username, cards_count
          FROM players
          WHERE telegram_id = ?
        `).bind(telegramId).first();

        return Response.json({
          success: true,
          player
        });

      } catch (error) {
        return Response.json(
          {
            success: false,
            error: "Authentication failed"
          },
          { status: 500 }
        );
      }
    }

    // Bingo game room
    if (url.pathname === "/api/room") {
      const id = env.BINGO_ROOM.idFromName("main");
      return env.BINGO_ROOM.get(id).fetch(request);
    }

    // Website and Mini App files
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    return Response.json(
      { error: "Not found" },
      { status: 404 }
    );
  }
};

export class BingoRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch() {
    return Response.json({
      success: true,
      room: "BUNA BINGO",
      maxPlayers: 500,
      maxCardsPerPlayer: 4,
      cardPrice: 10,
      prizePercentage: 60
    });
  }
}
