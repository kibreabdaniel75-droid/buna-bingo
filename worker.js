
const GAME_URL = "https://buna-bingo-backend.kibreabdaniel75.workers.dev/";
const CHANNEL = "@bunabingoo";
const BOT_USERNAME = "BunaBingoGameBot";
const SUPPORT = "@bunabingoosupport";

async function tg(env, method, data) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }
  );

  const result = await response.json();

  if (!result.ok) {
    throw new Error("Telegram API: " + result.description);
  }

  return result;
}

function menuKeyboard() {
  return {
    keyboard: [
      [
        { text: "💰 Balance" },
        { text: "🎮 Game Rules" }
      ],
      [
        { text: "🎧 Support" },
        { text: "🔗 Invite Link" }
      ],
      [
        { text: "📱 Share Contact", request_contact: true },
        {
          text: "🎮 Play BUNA BINGO",
          web_app: { url: GAME_URL }
        }
      ]
    ],
    resize_keyboard: true
  };
}

async function sendWelcome(env, chatId) {
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text:
      "👋 ወደ Buna BINGO እንኳን በደህና መጡ!\n\n" +
      "ቀጥለው ለመሄድ መጀመሪያ የTelegram ቻናላችንን ይቀላቀሉ። " +
      "ቻናሉን እንደተቀላቀሉ ቦቱ በራሱ ወዲያውኑ ያረጋግጣል!",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "📢 Join Telegram Channel",
            url: "https://t.me/bunabingoo"
          }
        ],
        [
          {
            text: "✅ I've Joined — Verify",
            callback_data: "verify_channel"
          }
        ]
      ]
    }
  });

  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: "👇 ከታች ያሉትን ሜኑዎች ይጠቀሙ።",
    reply_markup: menuKeyboard()
  });
}

async function checkMembership(env, userId) {
  const result = await tg(env, "getChatMember", {
    chat_id: CHANNEL,
    user_id: userId
  });

  const member = result.result;

  return (
    member.status === "creator" ||
    member.status === "administrator" ||
    member.status === "member" ||
    (member.status === "restricted" && member.is_member === true)
  );
}

async function getOrCreatePlayer(env, user) {
  const telegramId = String(user.id);

  await env.DB.prepare(`
    INSERT INTO players (
      id, telegram_id, username, first_name, last_name
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

  let player = await env.DB.prepare(`
    SELECT *
    FROM players
    WHERE telegram_id = ?
  `).bind(telegramId).first();

  if (!player.referral_code) {
    const code = crypto.randomUUID().replace(/-/g, "").slice(0, 12);

    await env.DB.prepare(`
      UPDATE players
      SET referral_code = ?
      WHERE telegram_id = ?
        AND referral_code IS NULL
    `).bind(code, telegramId).run();

    player = await env.DB.prepare(`
      SELECT *
      FROM players
      WHERE telegram_id = ?
    `).bind(telegramId).first();
  }

  return player;
}

async function registerReferral(env, player, payload) {
  if (!payload || !payload.startsWith("ref_")) return;

  const code = payload.slice(4);

  const referrer = await env.DB.prepare(`
    SELECT telegram_id
    FROM players
    WHERE referral_code = ?
  `).bind(code).first();

  if (!referrer || referrer.telegram_id === player.telegram_id) {
    return;
  }

  await env.DB.prepare(`
    INSERT OR IGNORE INTO referrals (
      id, referrer_id, referred_id
    )
    VALUES (?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    referrer.telegram_id,
    player.telegram_id
  ).run();
}

async function showBalance(env, chatId, player) {
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text:
      "👤 የእርስዎ ሂሳብ\n" +
      "💵 Main Balance: " +
      Number(player.main_balance || 0).toFixed(2) + " ETB\n" +
      "🎁 Bonus Balance: " +
      Number(player.bonus_balance || 0).toFixed(2) + " ETB\n" +
      "💳 Deposit አድርገዋል: " +
      (player.has_deposited ? "አዎ" : "ገና አይደለም"),
    reply_markup: menuKeyboard()
  });
}

async function showRules(env, chatId) {
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text:
      "🎮 የBingo ህጎች\n" +
      "• አንድ ካርድ 10 ETB ነው።\n" +
      "• Bonus Balance ቀድሞ ይቀነሳል፤ ቀሪው ከMain Balance ይቀነሳል።\n" +
      "• የጨዋታ ሽልማት ወደ Main Balance ይገባል።\n" +
      "• ገንዘብ ለማውጣት ቢያንስ አንድ ጊዜ Deposit ማድረግ ያስፈልጋል።",
    reply_markup: menuKeyboard()
  });
}

async function showSupport(env, chatId) {
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: "🎧 እርዳታ ለማግኘት @bunabingoosupport ያነጋግሩ።",
    reply_markup: menuKeyboard()
  });
}

async function showInvite(env, chatId, player) {
  const count = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM referrals
    WHERE referrer_id = ?
  `).bind(player.telegram_id).first();

  const link =
    `https://t.me/${BOT_USERNAME}?start=ref_${player.referral_code}`;

  await tg(env, "sendMessage", {
    chat_id: chatId,
    text:
      "🔗 የእርስዎ የግብዣ ሊንክ\n\n" +
      link + "\n\n" +
      "👥 የጋበዙት ተጫዋቾች: " +
      Number(count.total || 0),
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "📤 Share Invite Link",
            url:
              "https://t.me/share/url?url=" +
              encodeURIComponent(link)
          }
        ]
      ]
    }
  });
}

async function handleContact(env, message) {
  const sender = message.from;
  const contact = message.contact;

  if (
    !contact.user_id ||
    String(contact.user_id) !== String(sender.id)
  ) {
    await tg(env, "sendMessage", {
      chat_id: message.chat.id,
      text: "⚠️ እባክዎ የራስዎን Contact በShare Contact ቁልፍ ያጋሩ።",
      reply_markup: menuKeyboard()
    });
    return;
  }

  await getOrCreatePlayer(env, sender);

  await env.DB.prepare(`
    UPDATE players
    SET phone_number = ?,
        first_name = ?,
        last_name = ?
    WHERE telegram_id = ?
  `).bind(
    contact.phone_number,
    contact.first_name || sender.first_name || null,
    contact.last_name || sender.last_name || null,
    String(sender.id)
  ).run();

  await tg(env, "sendMessage", {
    chat_id: message.chat.id,
    text:
      "✅ Contact ተመዝግቧል!\n\n" +
      "👤 " +
      (contact.first_name || sender.first_name || "") +
      (contact.last_name ? " " + contact.last_name : "") +
      "\n📱 " + contact.phone_number,
    reply_markup: menuKeyboard()
  });
}

async function handleWebhook(env, update) {
  // Inline button: verify channel membership
  if (update.callback_query) {
    const query = update.callback_query;

    if (query.data === "verify_channel") {
      try {
        const joined = await checkMembership(env, query.from.id);

        if (joined) {
          await tg(env, "answerCallbackQuery", {
            callback_query_id: query.id,
            text: "Membership verified!"
          });

          await tg(env, "sendMessage", {
            chat_id: query.message.chat.id,
            text: "✅ ቻናሉን በተሳካ ሁኔታ ተቀላቅለዋል! እንኳን ደስ አለዎት።",
            reply_markup: menuKeyboard()
          });
        } else {
          await tg(env, "answerCallbackQuery", {
            callback_query_id: query.id,
            text: "እባክዎ መጀመሪያ ቻናሉን ይቀላቀሉ!",
            show_alert: true
          });
        }
      } catch {
        await tg(env, "answerCallbackQuery", {
          callback_query_id: query.id,
          text: "ማረጋገጥ አልተቻለም። እንደገና ይሞክሩ።",
          show_alert: true
        });
      }
    }

    return;
  }

  const message = update.message;
  if (!message || !message.from) return;

  const chatId = message.chat.id;
  const user = message.from;

  // Start command and referral payload
  if (typeof message.text === "string" &&
      message.text.startsWith("/start")) {
    const player = await getOrCreatePlayer(env, user);
    const payload = message.text.split(/\s+/)[1];

    await registerReferral(env, player, payload);

    await sendWelcome(env, chatId);
    return;
  }

  // Contact sharing
  if (message.contact) {
    await handleContact(env, message);
    return;
  }

  const player = await getOrCreatePlayer(env, user);

  // Require channel membership before using menu features
  let joined = false;

  try {
    joined = await checkMembership(env, user.id);
  } catch {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "⚠️ የቻናሉን አባልነት ማረጋገጥ አልተቻለም።"
    });
    return;
  }

  if (!joined) {
    await sendWelcome(env, chatId);
    return;
  }

  switch (message.text) {
    case "💰 Balance":
      await showBalance(env, chatId, player);
      break;

    case "🎮 Game Rules":
      await showRules(env, chatId);
      break;

    case "🎧 Support":
      await showSupport(env, chatId);
      break;

    case "🔗 Invite Link":
      await showInvite(env, chatId, player);
      break;

    default:
      break;
  }
}

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
        await handleWebhook(env, update);
        return Response.json({ ok: true });
      } catch (error) {
        return Response.json(
          { ok: false, error: "Webhook failed" },
          { status: 500 }
        );
      }
    }

    // Mini App authentication
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
            { success: false, error: "Invalid Telegram authentication" },
            { status: 401 }
          );
        }

        const player = await getOrCreatePlayer(env, user);

        return Response.json({
          success: true,
          player: {
            id: player.id,
            telegram_id: player.telegram_id,
            first_name: player.first_name,
            last_name: player.last_name,
            phone_number: player.phone_number,
            main_balance: player.main_balance,
            bonus_balance: player.bonus_balance,
            has_deposited: player.has_deposited,
            cards_count: player.cards_count
          }
        });

      } catch (error) {
        return Response.json(
          { success: false, error: "Authentication failed" },
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
