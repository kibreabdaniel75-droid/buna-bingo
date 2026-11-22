
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
      await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(message)
      )
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

async function sendTelegramMessage(env, chatId) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: "👋 Welcome to BUNA BINGO!\n\nReady to play? Tap the button below to enter the game.",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🎮 Play BUNA BINGO",
                web_app: {
                  url: "https://buna-bingo-backend.kibreabdaniel75.workers.dev/"
                }
              }
            ]
          ]
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error("Telegram message delivery failed");
  }

  return response.json();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Telegram webhook
    if (
      url.pathname === "/api/telegram/webhook" &&
      request.method === "POST"
    ) {
      if (
        !env.WEBHOOK_SECRET ||
        request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET
      ) {
        return Response.json(
          { ok: false, error: "Unauthorized" },
          { status: 401 }
        );
      }

      try {
        const update = await request.json();
        const message = update.message;

        if (
          message &&
          typeof message.text === "string" &&
          message.text.startsWith("/start")
        ) {
          await sendTelegramMessage(env, message.chat.id);
        }

        return Response.json({ ok: true });

      } catch (error) {
        return Response.json(
          { ok: false, error: "Webhook failed" },
          { status: 500 }
        );
      }
    }

    // Telegram Mini App authentication
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

    // Bingo room
    if (url.pathname === "/api/room") {
      const id = env.BINGO_ROOM.idFromName("main");
      return env.BINGO_ROOM.get(id).fetch(request);
    }

    // Website
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
