
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

async function telegramRequest(env, method, data) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error("Telegram API request failed");
  }

  return result;
}

async function sendWelcome(env, chatId) {
  return telegramRequest(env, "sendMessage", {
    chat_id: chatId,
    text:
      "👋 Welcome to BUNA BINGO!\n\n" +
      "📱 Please share your phone number to register and continue.",
    reply_markup: {
      keyboard: [
        [
          {
            text: "📱 Share Contact",
            request_contact: true
          }
        ]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
}

async function sendPlayerDetails(env, chatId, player) {
  return telegramRequest(env, "sendMessage", {
    chat_id: chatId,
    text:
      "✅ Registration successful!\n\n" +
      "👤 Name: " + player.firstName +
      (player.lastName ? " " + player.lastName : "") +
      "\n📱 Phone: " + player.phoneNumber +
      "\n\n🎮 You're ready to play BUNA BINGO!",
    reply_markup: {
      keyboard: [
        [
          {
            text: "🎮 Play BUNA BINGO",
            web_app: {
              url: "https://buna-bingo-backend.kibreabdaniel75.workers.dev/"
            }
          }
        ]
      ],
      resize_keyboard: true
    }
  });
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
        request.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
          env.WEBHOOK_SECRET
      ) {
        return Response.json(
          { ok: false, error: "Unauthorized" },
          { status: 401 }
        );
      }

      try {
        const update = await request.json();
        const message = update.message;

        if (message) {
          const chatId = message.chat.id;
          const sender = message.from;

          // Start command
          if (
            typeof message.text === "string" &&
            message.text.startsWith("/start")
          ) {
            await sendWelcome(env, chatId);
          }

          // Contact sharing
          else if (message.contact) {
            const contact = message.contact;

            // Only accept the sender's own Telegram contact
            if (
              !sender ||
              !contact.user_id ||
              String(contact.user_id) !== String(sender.id)
            ) {
              await telegramRequest(env, "sendMessage", {
                chat_id: chatId,
                text:
                  "⚠️ Please use the Share Contact button to share your own phone number."
              });
            } else {
              const telegramId = String(sender.id);
              const firstName = contact.first_name || sender.first_name || "";
              const lastName = contact.last_name || sender.last_name || "";
              const phoneNumber = contact.phone_number;

              await env.DB.prepare(`
                INSERT INTO players (
                  id,
                  telegram_id,
                  username,
                  first_name,
                  last_name,
                  phone_number
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(telegram_id)
                DO UPDATE SET
                  username = excluded.username,
                  first_name = excluded.first_name,
                  last_name = excluded.last_name,
                  phone_number = excluded.phone_number
              `).bind(
                crypto.randomUUID(),
                telegramId,
                sender.username || null,
                firstName,
                lastName,
                phoneNumber
              ).run();

              await sendPlayerDetails(env, chatId, {
                firstName,
                lastName,
                phoneNumber
              });
            }
          }
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

        await env.DB.prepare(`
          INSERT INTO players (
            id,
            telegram_id,
            username,
            first_name,
            last_name
          )
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(telegram_id)
          DO UPDATE SET
            username = excluded.username,
            first_name = excluded.first_name,
            last_name = excluded.last_name
        `).bind(
          crypto.randomUUID(),
          telegramId,
          user.username || null,
          user.first_name || null,
          user.last_name || null
        ).run();

        const player = await env.DB.prepare(`
          SELECT
            id,
            telegram_id,
            username,
            first_name,
            last_name,
            phone_number,
            cards_count
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
