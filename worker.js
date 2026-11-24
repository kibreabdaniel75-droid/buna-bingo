
const GAME_URL = "https://buna-bingo-backend.kibreabdaniel75.workers.dev/";
const CHANNEL = "@bunabingoo";
const BOT_USERNAME = "BunaBingoGameBot";
const SUPPORT = "@bunabingoosupport";

// TELEGRAM API
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
    console.error("TELEGRAM API REJECTED:", method, result);
    throw new Error(
      "Telegram API " + method + ": " + JSON.stringify(result)
    );
  }

  return result;
}

// REMOVE OLD KEYBOARD
async function removeKeyboard(env, chatId) {
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: " ",
    reply_markup: { remove_keyboard: true }
  });
}

// MAIN MENU
function menuKeyboard() {
  return {
    keyboard: [
      [{ text: "🎮 Play BUNA BINGO" }],
      [
        { text: "💰 Balance" },
        { text: "🎮 Game Rules" }
      ],
      [
        { text: "🎧 Support" },
        { text: "🔗 Invite Link" }
      ]
    ],
    resize_keyboard: true
  };
}

// CONTACT BUTTON
function contactKeyboard() {
  return {
    keyboard: [
      [{ text: "📱 Share Contact", request_contact: true }]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  };
}

// WELCOME MESSAGE
async function sendWelcome(env, chatId) {
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text:
      "👋 ወደ Buna BINGO እንኳን በደህና መጡ!\n\n" +
      "ቀጥለው ለመሄድ መጀመሪያ የTelegram ቻናላችንን ይቀላቀሉ። " +
      "ቻናሉን እንደተቀላቀሉ ቦቱ በራሱ ወዲያውኑ ያረጋግጣል!",
    reply_markup: {
      inline_keyboard: [
        [{ text: "📢 Join Telegram Channel", url: "https://t.me/bunabingoo" }],
        [{ text: "✅ I've Joined — Verify", callback_data: "verify_channel" }]
      ]
    }
  });
}

// CHECK CHANNEL MEMBERSHIP
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

// CREATE OR UPDATE PLAYER
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
    SELECT * FROM players WHERE telegram_id = ?
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
      SELECT * FROM players WHERE telegram_id = ?
    `).bind(telegramId).first();
  }

  return player;
}

// REGISTER REFERRAL
async function registerReferral(env, player, payload) {
  if (!payload || !payload.startsWith("ref_")) return;

  const code = payload.slice(4);

  const referrer = await env.DB.prepare(`
    SELECT telegram_id FROM players WHERE referral_code = ?
  `).bind(code).first();

  if (!referrer || referrer.telegram_id === player.telegram_id) return;

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

// BALANCE
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

// GAME RULES
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

// SUPPORT
async function showSupport(env, chatId) {
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: "🎧 እርዳታ ለማግኘት @bunabingoosupport ያነጋግሩ።",
    reply_markup: menuKeyboard()
  });
}

// INVITE LINK
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
        [{
          text: "📤 Share Invite Link",
          url: "https://t.me/share/url?url=" + encodeURIComponent(link)
        }]
      ]
    }
  });
}

// HANDLE CONTACT
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
      reply_markup: contactKeyboard()
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

// WEBHOOK HANDLER
async function handleWebhook(env, update) {
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
            reply_markup: contactKeyboard()
          });
        } else {
          await tg(env, "answerCallbackQuery", {
            callback_query_id: query.id,
            text: "እባክዎ መጀመሪያ ቻናሉን ይቀላቀሉ!",
            show_alert: true
          });
        }
      } catch (error) {
        console.error("CHANNEL VERIFICATION ERROR:", error);

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

  // START
  if (
    typeof message.text === "string" &&
    message.text.startsWith("/start")
  ) {
    const player = await getOrCreatePlayer(env, user);
    const payload = message.text.split(/\s+/)[1];

    await registerReferral(env, player, payload);
    await sendWelcome(env, chatId);
    return;
  }

  // CONTACT
  if (message.contact) {
    let joined = false;

    try {
      joined = await checkMembership(env, user.id);
    } catch (error) {
      console.error("CONTACT MEMBERSHIP CHECK ERROR:", error);
    }

    if (!joined) {
      await sendWelcome(env, chatId);
      return;
    }

    await handleContact(env, message);
    return;
  }

  const player = await getOrCreatePlayer(env, user);

  // MEMBERSHIP
  let joined = false;

  try {
    joined = await checkMembership(env, user.id);
  } catch (error) {
    console.error("MEMBERSHIP CHECK ERROR:", error);

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

  // CONTACT REQUIRED
  if (!player.phone_number) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "📱 Please share your contact to continue.",
      reply_markup: contactKeyboard()
    });
    return;
  }

  // MENU
  switch (message.text) {
    case "🎮 Play BUNA BINGO":
      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: "🎮 Ready to play Buna Bingo?",
        reply_markup: {
          inline_keyboard: [[
            {
              text: "🎮 PLAY 10 ETB",
              web_app: { url: GAME_URL }
            }
          ]]
        }
      });
      break;

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

// MINI APP AUTHENTICATION
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

// CLOUDFLARE WORKER
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // TELEGRAM WEBHOOK
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
        console.error("BUNA BINGO WEBHOOK ERROR:", error);

        return Response.json(
          { ok: false, error: "Webhook failed" },
          { status: 500 }
        );
      }
    }

    // MINI APP AUTH
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
        console.error("MINI APP AUTH ERROR:", error);

        return Response.json(
          { success: false, error: "Authentication failed" },
          { status: 500 }
        );
      }
    }

    // BINGO ROOM
    if (url.pathname === "/api/room" && request.method === "GET") {
      const id = env.BINGO_ROOM.idFromName("main");
      return env.BINGO_ROOM.get(id).fetch(request);
    }

    // RESERVE BINGO CARDS
    if (
      url.pathname === "/api/room/reserve" &&
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

        if (!player.phone_number) {
          return Response.json(
            { success: false, error: "Please share your contact first." },
            { status: 403 }
          );
        }

        const cards = body.cards;

        if (
          !Array.isArray(cards) ||
          cards.length < 1 ||
          cards.length > 4 ||
          cards.some(n => !Number.isInteger(n) || n < 1 || n > 500) ||
          new Set(cards).size !== cards.length
        ) {
          return Response.json(
            { success: false, error: "Select 1 to 4 valid cards." },
            { status: 400 }
          );
        }

        const id = env.BINGO_ROOM.idFromName("main");

        const roomRequest = new Request(
          "https://buna-bingo.internal/reserve",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              playerId: player.id,
              telegramId: player.telegram_id,
              cards
            })
          }
        );

        return env.BINGO_ROOM.get(id).fetch(roomRequest);

      } catch (error) {
        console.error("BINGO RESERVATION ERROR:", error);

        return Response.json(
          { success: false, error: "Reservation failed." },
          { status: 500 }
        );
      }
    }

    // WEBSITE
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    return Response.json(
      { error: "Not found" },
      { status: 404 }
    );
  }
};

// DURABLE OBJECT
export class BingoRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;

    this.queue = Promise.resolve();

    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      let room = await this.ctx.storage.get("room");

      if (!room) {
        room = {
          name: "BUNA BINGO",
          status: "waiting",
          maxPlayers: 500,
          minPlayers: 2,
          maxCardsPerPlayer: 4,
          cardPrice: 10,
          prizePercentage: 60,
          platformPercentage: 40,
          countdownSeconds: 60,
          playersCount: 0,
          cardsSold: 0,
          totalSales: 0,
          prizePool: 0,
          roundId: crypto.randomUUID(),
          countdownEndsAt: null
        };

        await this.ctx.storage.put("room", room);
        await this.ctx.storage.put("reservations", {});
      }
    });
  }

  async fetch(request) {
    await this.ready;

    if (request.method === "GET") {
      const room = await this.ctx.storage.get("room");
      const reservations =
        await this.ctx.storage.get("reservations") || {};

      return Response.json({
        success: true,
        room,
        reservedCards: Object.keys(reservations).map(Number)
      });
    }

    if (
      request.method === "POST" &&
      new URL(request.url).pathname === "/reserve"
    ) {
      const task = this.queue.then(
        () => this.reserve(request),
        () => this.reserve(request)
      );

      this.queue = task.then(
        () => undefined,
        () => undefined
      );

      return task;
    }

    return Response.json(
      { success: false, error: "Method not allowed" },
      { status: 405 }
    );
  }

  async reserve(request) {
    const body = await request.json();

    const { playerId, telegramId, cards } = body;

    if (!playerId || !telegramId || !Array.isArray(cards)) {
      return Response.json(
        { success: false, error: "Invalid reservation data." },
        { status: 400 }
      );
    }

    const room = await this.ctx.storage.get("room");
    const reservations =
      await this.ctx.storage.get("reservations") || {};

    if (
      room.status !== "waiting" &&
      room.status !== "countdown"
    ) {
      return Response.json(
        { success: false, error: "This round is closed." },
        { status: 409 }
      );
    }

    if (
      cards.length < 1 ||
      cards.length > 4 ||
      cards.some(n => !Number.isInteger(n) || n < 1 || n > 500) ||
      new Set(cards).size !== cards.length
    ) {
      return Response.json(
        { success: false, error: "Invalid card selection." },
        { status: 400 }
      );
    }

    const myCards = Object.values(reservations)
      .filter(r => r.playerId === playerId);

    if (myCards.length + cards.length > 4) {
      return Response.json(
        { success: false, error: "Maximum 4 cards per player." },
        { status: 400 }
      );
    }

    for (const card of cards) {
      if (reservations[card]) {
        return Response.json(
          {
            success: false,
            error: `Card ${card} is already reserved.`
          },
          { status: 409 }
        );
      }
    }

    const existingPlayers = new Set(
      Object.values(reservations).map(r => r.playerId)
    );

    if (
      !existingPlayers.has(playerId) &&
      existingPlayers.size >= room.maxPlayers
    ) {
      return Response.json(
        { success: false, error: "Room is full." },
        { status: 409 }
      );
    }

    const total = cards.length * room.cardPrice;

    const player = await this.env.DB.prepare(`
      SELECT id, main_balance, bonus_balance
      FROM players
      WHERE id = ? AND telegram_id = ?
    `).bind(playerId, String(telegramId)).first();

    if (!player) {
      return Response.json(
        { success: false, error: "Player account not found." },
        { status: 404 }
      );
    }

    const bonus = Math.max(0, Number(player.bonus_balance || 0));
    const main = Math.max(0, Number(player.main_balance || 0));

    if (bonus + main < total) {
      return Response.json(
        { success: false, error: "Insufficient balance." },
        { status: 400 }
      );
    }

    // BONUS FIRST, THEN MAIN BALANCE
    const bonusUsed = Math.min(bonus, total);
    const mainUsed = total - bonusUsed;

    const payment = await this.env.DB.prepare(`
      UPDATE players
      SET
        bonus_balance = COALESCE(bonus_balance, 0) - ?,
        main_balance = COALESCE(main_balance, 0) - ?,
        cards_count = COALESCE(cards_count, 0) + ?
      WHERE id = ?
        AND telegram_id = ?
        AND COALESCE(bonus_balance, 0) +
            COALESCE(main_balance, 0) >= ?
    `).bind(
      bonusUsed,
      mainUsed,
      cards.length,
      playerId,
      String(telegramId),
      total
    ).run();

    if (!payment.meta || payment.meta.changes !== 1) {
      return Response.json(
        { success: false, error: "Balance changed. Please try again." },
        { status: 409 }
      );
    }

    const updatedReservations = { ...reservations };

    for (const card of cards) {
      updatedReservations[card] = {
        playerId,
        telegramId: String(telegramId),
        reservedAt: Date.now()
      };
    }

    const updatedRoom = { ...room };

    updatedRoom.cardsSold += cards.length;
    updatedRoom.totalSales += total;
    updatedRoom.prizePool =
      updatedRoom.totalSales *
      updatedRoom.prizePercentage / 100;

    const players = new Set(
      Object.values(updatedReservations).map(r => r.playerId)
    );

    updatedRoom.playersCount = players.size;

    if (
      updatedRoom.playersCount >= updatedRoom.minPlayers &&
      updatedRoom.status === "waiting"
    ) {
      updatedRoom.status = "countdown";
      updatedRoom.countdownEndsAt =
        Date.now() + updatedRoom.countdownSeconds * 1000;

      await this.ctx.storage.setAlarm(
        updatedRoom.countdownEndsAt
      );
    }

    try {
      await this.ctx.storage.transaction(async (txn) => {
        await txn.put("reservations", updatedReservations);
        await txn.put("room", updatedRoom);
      });
    } catch (error) {
      // REFUND IF ROOM STORAGE FAILS
      await this.env.DB.prepare(`
        UPDATE players
        SET
          bonus_balance = COALESCE(bonus_balance, 0) + ?,
          main_balance = COALESCE(main_balance, 0) + ?,
          cards_count = MAX(0, COALESCE(cards_count, 0) - ?)
        WHERE id = ?
      `).bind(
        bonusUsed,
        mainUsed,
        cards.length,
        playerId
      ).run();

      throw error;
    }

    const updatedPlayer = await this.env.DB.prepare(`
      SELECT main_balance, bonus_balance
      FROM players
      WHERE id = ?
    `).bind(playerId).first();

    return Response.json({
      success: true,
      message: "Cards reserved successfully!",
      reservedCards: cards,
      charged: total,
      bonusUsed,
      mainUsed,
      mainBalance: Number(updatedPlayer.main_balance || 0),
      bonusBalance: Number(updatedPlayer.bonus_balance || 0),
      room: updatedRoom
    });
  }

  async alarm() {
    await this.ready;

    const room = await this.ctx.storage.get("room");

    if (
      room &&
      room.status === "countdown" &&
      room.countdownEndsAt &&
      Date.now() >= room.countdownEndsAt
    ) {
      room.status = "ready";
      room.countdownEndsAt = null;

      await this.ctx.storage.put("room", room);
    }
  }
}
