
const GAME_URL = "https://buna-bingo-backend.kibreabdaniel75.workers.dev/";
const CHANNEL = "@bunabingoo";
const BOT_USERNAME = "BunaBingoGameBot";
const SUPPORT = "@bunabingoosupport";

const CARD_PRICE = 10;
const MAX_CARDS = 4;
const MAX_CARD_SLOTS = 500;
const COUNTDOWN_SECONDS = 60;
const CALL_INTERVAL_MS = 5000;

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
    console.error("TELEGRAM API ERROR:", result);
    throw new Error("Telegram API error: " + JSON.stringify(result));
  }

  return result;
}

function menuKeyboard() {
  return {
    keyboard: [
      [{ text: "🎮 Play BUNA BINGO" }],
      [{ text: "💰 Balance" }, { text: "🎮 Game Rules" }],
      [{ text: "🎧 Support" }, { text: "🔗 Invite Link" }]
    ],
    resize_keyboard: true
  };
}

function contactKeyboard() {
  return {
    keyboard: [
      [{ text: "📱 Share Contact", request_contact: true }]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  };
}

// CREATE PROMO CODE - ADMIN ONLY
async function createPromoCode(env, message) {
  const user = message.from;
  const chatId = message.chat.id;

  if (
    message.chat.type !== "private" ||
    !env.ADMIN_TELEGRAM_ID ||
    String(user.id) !== String(env.ADMIN_TELEGRAM_ID)
  ) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "⛔ You are not authorized to create promo codes."
    });
    return;
  }

  const parts = message.text.trim().split(/\s+/);

  if (parts.length !== 4) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text:
        "Format:\n/createcode CODE BONUS LIMIT\n\n" +
        "Example:\n/createcode BUNA20 20 100"
    });
    return;
  }

  const code = parts[1].toUpperCase();
  const bonus = Number(parts[2]);
  const limit = Number(parts[3]);

  if (
    !/^[A-Z0-9_-]{3,30}$/.test(code) ||
    !Number.isFinite(bonus) ||
    bonus <= 0 ||
    bonus > 100000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100000
  ) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "⚠️ Invalid code, bonus amount, or redemption limit."
    });
    return;
  }

  try {
    await env.DB.prepare(`
      INSERT INTO promo_codes (
        code,
        bonus_amount,
        max_redemptions,
        redeemed_count,
        active,
        created_by,
        created_at
      )
      VALUES (?, ?, ?, 0, 1, ?, ?)
    `).bind(
      code,
      bonus,
      limit,
      String(user.id),
      Date.now()
    ).run();

    await tg(env, "sendMessage", {
      chat_id: chatId,
      text:
        "✅ Promo code created!\n\n" +
        "🎟 Code: " + code + "\n" +
        "🎁 Bonus: " + bonus + " ETB\n" +
        "👥 Maximum uses: " + limit + "\n\n" +
        "Copy and post it in your channel whenever you want."
    });
  } catch (error) {
    console.error("PROMO CREATION ERROR:", error);

    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "⚠️ Could not create this code. It may already exist."
    });
  }
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
        [{ text: "📢 Join Telegram Channel", url: "https://t.me/bunabingoo" }],
        [{ text: "✅ I've Joined — Verify", callback_data: "verify_channel" }]
      ]
    }
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
    SELECT * FROM players WHERE telegram_id = ?
  `).bind(telegramId).first();

  if (!player.referral_code) {
    const code = crypto.randomUUID().replace(/-/g, "").slice(0, 12);

    await env.DB.prepare(`
      UPDATE players
      SET referral_code = ?
      WHERE telegram_id = ? AND referral_code IS NULL
    `).bind(code, telegramId).run();

    player = await env.DB.prepare(`
      SELECT * FROM players WHERE telegram_id = ?
    `).bind(telegramId).first();
  }

  return player;
}

async function registerReferral(env, player, payload) {
  if (!payload || !payload.startsWith("ref_")) return;

  const code = payload.slice(4);

  const referrer = await env.DB.prepare(`
    SELECT telegram_id FROM players WHERE referral_code = ?
  `).bind(code).first();

  if (!referrer || referrer.telegram_id === player.telegram_id) return;

  await env.DB.prepare(`
    INSERT OR IGNORE INTO referrals (id, referrer_id, referred_id)
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
      inline_keyboard: [[{
        text: "📤 Share Invite Link",
        url: "https://t.me/share/url?url=" + encodeURIComponent(link)
      }]]
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
      reply_markup: contactKeyboard()
    });
    return;
  }

  await getOrCreatePlayer(env, sender);

  await env.DB.prepare(`
    UPDATE players
    SET phone_number = ?, first_name = ?, last_name = ?
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

  // ADMIN PROMO CODE COMMAND
  if (
    typeof message.text === "string" &&
    message.text.trim().split(/\s+/)[0].split("@")[0] === "/createcode"
  ) {
    await createPromoCode(env, message);
    return;
  }

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

  if (!player.phone_number) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "📱 Please share your contact to continue.",
      reply_markup: contactKeyboard()
    });
    return;
  }

  switch (message.text) {
    case "🎮 Play BUNA BINGO":
      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: "🎮 Ready to play Buna Bingo?",
        reply_markup: {
          inline_keyboard: [[{
            text: "🎮 PLAY 10 ETB",
            web_app: { url: GAME_URL }
          }]]
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
  }
}

// TELEGRAM MINI APP AUTH
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

// JSON RESPONSE
function json(data, status = 200) {
  return Response.json(data, { status });
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
        return json({ ok: false, error: "Unauthorized" }, 401);
      }

      try {
        await handleWebhook(env, await request.json());
        return json({ ok: true });
      } catch (error) {
        console.error("WEBHOOK ERROR:", error);
        return json({ ok: false, error: "Webhook failed" }, 500);
      }
    }

    // MINI APP AUTH
    if (
      url.pathname === "/api/auth/telegram" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();
        const user = await verifyTelegram(body.initData, env.BOT_TOKEN);

        if (!user || !user.id) {
          return json({
            success: false,
            error: "Invalid Telegram authentication"
          }, 401);
        }

        const player = await getOrCreatePlayer(env, user);

        return json({
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
        console.error("AUTH ERROR:", error);
        return json({ success: false, error: "Authentication failed" }, 500);
      }
    }

    // REDEEM PROMO CODE
    if (
      url.pathname === "/api/promo/redeem" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();
        const user = await verifyTelegram(body.initData, env.BOT_TOKEN);

        if (!user || !user.id) {
          return json({
            success: false,
            error: "Invalid authentication"
          }, 401);
        }

        const code = String(body.code || "").trim().toUpperCase();

        if (!/^[A-Z0-9_-]{3,30}$/.test(code)) {
          return json({
            success: false,
            error: "Please enter a valid promo code."
          }, 400);
        }

        const player = await getOrCreatePlayer(env, user);
        const telegramId = String(user.id);
        const redemptionId = crypto.randomUUID();
        const now = Date.now();

        // The three statements run as one atomic D1 batch.
        // A redemption is inserted only if the code is active,
        // has remaining uses, and this player has not used it.
        const results = await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO promo_redemptions (
              id,
              code,
              telegram_id,
              bonus_amount,
              redeemed_at
            )
            SELECT
              ?,
              promo.code,
              ?,
              promo.bonus_amount,
              ?
            FROM promo_codes AS promo
            WHERE promo.code = ?
              AND promo.active = 1
              AND promo.redeemed_count < promo.max_redemptions
              AND NOT EXISTS (
                SELECT 1
                FROM promo_redemptions AS old
                WHERE old.code = promo.code
                  AND old.telegram_id = ?
              )
              AND EXISTS (
                SELECT 1
                FROM players
                WHERE telegram_id = ?
              )
          `).bind(
            redemptionId,
            telegramId,
            now,
            code,
            telegramId,
            telegramId
          ),

          env.DB.prepare(`
            UPDATE promo_codes
            SET redeemed_count = redeemed_count + 1
            WHERE code = ?
              AND EXISTS (
                SELECT 1
                FROM promo_redemptions
                WHERE id = ?
              )
          `).bind(code, redemptionId),

          env.DB.prepare(`
            UPDATE players
            SET bonus_balance = COALESCE(bonus_balance, 0) + (
              SELECT bonus_amount
              FROM promo_redemptions
              WHERE id = ?
            )
            WHERE telegram_id = ?
              AND EXISTS (
                SELECT 1
                FROM promo_redemptions
                WHERE id = ?
              )
          `).bind(redemptionId, telegramId, redemptionId)
        ]);

        const inserted = results[0]?.meta?.changes || 0;

        if (inserted !== 1) {
          const existing = await env.DB.prepare(`
            SELECT 1
            FROM promo_redemptions
            WHERE code = ? AND telegram_id = ?
          `).bind(code, telegramId).first();

          if (existing) {
            return json({
              success: false,
              error: "You have already used this promo code."
            }, 409);
          }

          const promo = await env.DB.prepare(`
            SELECT active, redeemed_count, max_redemptions
            FROM promo_codes
            WHERE code = ?
          `).bind(code).first();

          if (!promo) {
            return json({
              success: false,
              error: "This promo code does not exist."
            }, 404);
          }

          if (!promo.active) {
            return json({
              success: false,
              error: "This promo code is no longer active."
            }, 400);
          }

          if (promo.redeemed_count >= promo.max_redemptions) {
            return json({
              success: false,
              error: "This promo code has reached its limit."
            }, 400);
          }

          return json({
            success: false,
            error: "Could not redeem this promo code. Please try again."
          }, 400);
        }

        const updatedPlayer = await env.DB.prepare(`
          SELECT main_balance, bonus_balance
          FROM players
          WHERE telegram_id = ?
        `).bind(telegramId).first();

        return json({
          success: true,
          message: "Promo code redeemed successfully!",
          bonusAdded: Number(results[0].meta.changes ? (
            await env.DB.prepare(`
              SELECT bonus_amount
              FROM promo_redemptions
              WHERE id = ?
            `).bind(redemptionId).first()
          ).bonus_amount : 0),
          mainBalance: Number(updatedPlayer.main_balance || 0),
          bonusBalance: Number(updatedPlayer.bonus_balance || 0)
        });

      } catch (error) {
        console.error("PROMO REDEMPTION ERROR:", error);
        return json({
          success: false,
          error: "Could not redeem promo code."
        }, 500);
      }
    }

    // PUBLIC ROUND STATUS
    if (url.pathname === "/api/room" && request.method === "GET") {
      const id = env.BINGO_ROOM.idFromName("main");

      return env.BINGO_ROOM.get(id).fetch(
        new Request("https://buna-bingo.internal/status")
      );
    }

    // PRIVATE PLAYER GAME STATE
    if (
      url.pathname === "/api/game/state" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();
        const user = await verifyTelegram(body.initData, env.BOT_TOKEN);

        if (!user || !user.id) {
          return json({ success: false, error: "Invalid authentication" }, 401);
        }

        const player = await getOrCreatePlayer(env, user);
        const id = env.BINGO_ROOM.idFromName("main");

        return env.BINGO_ROOM.get(id).fetch(
          new Request("https://buna-bingo.internal/player-state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              playerId: player.id,
              telegramId: player.telegram_id
            })
          })
        );
      } catch (error) {
        console.error("GAME STATE ERROR:", error);
        return json({ success: false, error: "Could not load game." }, 500);
      }
    }

    // PRIVATE PLAYING HISTORY
    if (
      url.pathname === "/api/game/history" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();
        const user = await verifyTelegram(body.initData, env.BOT_TOKEN);

        if (!user || !user.id) {
          return json({
            success: false,
            error: "Invalid authentication"
          }, 401);
        }

        const player = await getOrCreatePlayer(env, user);

        const result = await env.DB.prepare(`
          SELECT
            id,
            round_id,
            card_slots,
            cards_count,
            amount_spent,
            played_at
          FROM game_history
          WHERE telegram_id = ?
          ORDER BY played_at DESC
          LIMIT 50
        `).bind(player.telegram_id).all();

        const history = (result.results || []).map(item => {
          let cardSlots = [];

          try {
            cardSlots = JSON.parse(item.card_slots);
          } catch {
            cardSlots = [];
          }

          return {
            id: item.id,
            roundId: item.round_id,
            roomId: item.round_id.slice(0, 8).toUpperCase(),
            cardSlots,
            cardsCount: item.cards_count,
            amountSpent: item.amount_spent,
            playedAt: item.played_at
          };
        });

        return json({
          success: true,
          history
        });

      } catch (error) {
        console.error("HISTORY ERROR:", error);
        return json({
          success: false,
          error: "Could not load playing history."
        }, 500);
      }
    }

    // RESERVE CARDS
    if (
      url.pathname === "/api/room/reserve" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();
        const user = await verifyTelegram(body.initData, env.BOT_TOKEN);

        if (!user || !user.id) {
          return json({ success: false, error: "Invalid authentication" }, 401);
        }

        const player = await getOrCreatePlayer(env, user);

        if (!player.phone_number) {
          return json({
            success: false,
            error: "Please share your contact first."
          }, 403);
        }

        const cards = body.cards;

        if (
          !Array.isArray(cards) ||
          cards.length < 1 ||
          cards.length > MAX_CARDS ||
          cards.some(n => !Number.isInteger(n) || n < 1 || n > MAX_CARD_SLOTS) ||
          new Set(cards).size !== cards.length
        ) {
          return json({ success: false, error: "Select 1 to 4 valid cards." }, 400);
        }

        const id = env.BINGO_ROOM.idFromName("main");

        return env.BINGO_ROOM.get(id).fetch(
          new Request("https://buna-bingo.internal/reserve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              playerId: player.id,
              telegramId: player.telegram_id,
              cards
            })
          })
        );
      } catch (error) {
        console.error("RESERVATION ERROR:", error);
        return json({ success: false, error: "Reservation failed." }, 500);
      }
    }

    // CLAIM BINGO
    if (
      url.pathname === "/api/game/claim" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();
        const user = await verifyTelegram(body.initData, env.BOT_TOKEN);

        if (!user || !user.id) {
          return json({ success: false, error: "Invalid authentication" }, 401);
        }

        const player = await getOrCreatePlayer(env, user);
        const id = env.BINGO_ROOM.idFromName("main");

        return env.BINGO_ROOM.get(id).fetch(
          new Request("https://buna-bingo.internal/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              playerId: player.id,
              telegramId: player.telegram_id
            })
          })
        );
      } catch (error) {
        console.error("BINGO CLAIM ERROR:", error);
        return json({ success: false, error: "Could not check Bingo." }, 500);
      }
    }

    // WEBSITE ASSETS
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    return json({ error: "Not found" }, 404);
  }
};

// CREATE A RANDOM 75-BALL BINGO CARD
function generateBingoCard() {
  const columns = [
    [1, 15],
    [16, 30],
    [31, 45],
    [46, 60],
    [61, 75]
  ];

  const selectedColumns = columns.map(([min, max]) => {
    const numbers = [];

    while (numbers.length < 5) {
      const number = Math.floor(Math.random() * (max - min + 1)) + min;
      if (!numbers.includes(number)) numbers.push(number);
    }

    return numbers.sort((a, b) => a - b);
  });

  const rows = [];

  for (let row = 0; row < 5; row++) {
    rows.push(
      selectedColumns.map((column, col) =>
        row === 2 && col === 2 ? 0 : column[row]
      )
    );
  }

  return rows;
}

function shuffledNumbers() {
  const numbers = Array.from({ length: 75 }, (_, i) => i + 1);

  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }

  return numbers;
}

// CHECK HORIZONTAL, VERTICAL AND DIAGONAL BINGO
function hasBingo(card, calledNumbers) {
  const called = new Set(calledNumbers);

  const marked = (row, col) => {
    const value = card[row][col];
    return value === 0 || called.has(value);
  };

  for (let row = 0; row < 5; row++) {
    if ([0, 1, 2, 3, 4].every(col => marked(row, col))) return true;
  }

  for (let col = 0; col < 5; col++) {
    if ([0, 1, 2, 3, 4].every(row => marked(row, col))) return true;
  }

  if ([0, 1, 2, 3, 4].every(i => marked(i, i))) return true;
  if ([0, 1, 2, 3, 4].every(i => marked(i, 4 - i))) return true;

  return false;
}

// DURABLE OBJECT: ONE SHARED ROUND, PRIVATE PLAYER CARDS
export class BingoRoom {
  constructor(ctx, env) {
  this.ctx = ctx;
  this.env = env;
  this.queue = Promise.resolve();

  this.ready = this.ctx.blockConcurrencyWhile(async () => {
    let room = await this.ctx.storage.get("room");

    if (!room) {
      room = this.newRoom();

      await this.ctx.storage.put("room", room);
      await this.ctx.storage.put("reservations", {});
      await this.ctx.storage.put("numberSequence", []);
    }

    room.prizePercentage = 80;
    room.platformPercentage = 20;
    room.prizePool = Math.round(room.totalSales * 0.8 * 100) / 100;
    await this.ctx.storage.put("room", room);
  });
  }
    
  newRoom() {
    return {
      name: "BUNA BINGO",
      status: "waiting",
      maxPlayers: MAX_CARD_SLOTS,
      minPlayers: 2,
      maxCardsPerPlayer: MAX_CARDS,
      cardPrice: CARD_PRICE,
      prizePercentage: 80,
      platformPercentage: 20,
      countdownSeconds: COUNTDOWN_SECONDS,
      playersCount: 0,
      cardsSold: 0,
      totalSales: 0,
      prizePool: 0,
      roundId: crypto.randomUUID(),
      countdownEndsAt: null,
      calledNumbers: [],
      currentNumber: null,
      winner: null,
      winnerRevealEndsAt: null,
      startedAt: null,
      finishedAt: null
    };
  }

  async fetch(request) {
    await this.ready;

    const path = new URL(request.url).pathname;

    if (request.method === "GET" && path === "/status") {
      const room = await this.ctx.storage.get("room");
      const reservations =
        await this.ctx.storage.get("reservations") || {};

      return json({
        success: true,
        room,
        reservedCards: Object.keys(reservations).map(Number)
      });
    }

    if (request.method === "POST" && path === "/player-state") {
      const body = await request.json();
      return this.playerState(body);
    }

    if (request.method === "POST" && path === "/reserve") {
      return this.serial(() => this.reserve(request));
    }

    if (request.method === "POST" && path === "/claim") {
      return this.serial(() => this.claim(request));
    }

    return json({ success: false, error: "Not found" }, 404);
  }

  serial(task) {
    const result = this.queue.then(task, task);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async playerState(body) {
    const { playerId, telegramId } = body;

    if (!playerId || !telegramId) {
      return json({ success: false, error: "Invalid player." }, 400);
    }

    const room = await this.ctx.storage.get("room");
    const reservations =
      await this.ctx.storage.get("reservations") || {};

    const myCards = Object.entries(reservations)
      .filter(([, item]) =>
        item.playerId === playerId &&
        item.telegramId === String(telegramId)
      )
      .map(([slot, item]) => ({
        slot: Number(slot),
        card: item.card
      }));

    return json({
      success: true,
      privateRoomId: playerId,
      room: {
        name: room.name,
        roundId: room.roundId,
        status: room.status,
        countdownEndsAt: room.countdownEndsAt,
        calledNumbers: room.calledNumbers,
        currentNumber: room.currentNumber,
        cardsSold: room.cardsSold,
        playersCount: room.playersCount,
        prizePool: room.prizePool,
        winner: room.winner,
        winnerRevealEndsAt: room.winnerRevealEndsAt,
        finishedAt: room.finishedAt
      },
      myCards
    });
  }

  // SAVE EVERY PLAYER'S PLAYING HISTORY
  async saveRoundHistory(room, reservations) {
    const players = {};

    for (const [slot, item] of Object.entries(reservations)) {
      if (!players[item.playerId]) {
        players[item.playerId] = {
          telegramId: String(item.telegramId),
          slots: []
        };
      }

      players[item.playerId].slots.push(Number(slot));
    }

    for (const [playerId, data] of Object.entries(players)) {
      const count = data.slots.length;

      await this.env.DB.prepare(`
        INSERT OR IGNORE INTO game_history (
          id,
          player_id,
          telegram_id,
          round_id,
          card_slots,
          cards_count,
          amount_spent,
          played_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        playerId,
        data.telegramId,
        room.roundId,
        JSON.stringify(data.slots.sort((a, b) => a - b)),
        count,
        count * room.cardPrice,
        room.finishedAt || Date.now()
      ).run();
    }
  }

  async reserve(request) {
    const body = await request.json();
    const { playerId, telegramId, cards } = body;

    if (!playerId || !telegramId || !Array.isArray(cards)) {
      return json({
        success: false,
        error: "Invalid reservation data."
      }, 400);
    }

    const room = await this.ctx.storage.get("room");
    const reservations =
      await this.ctx.storage.get("reservations") || {};

    if (room.status !== "waiting" && room.status !== "countdown") {
      return json({
        success: false,
        error: "This round is closed."
      }, 409);
    }

    if (
      cards.length < 1 ||
      cards.length > MAX_CARDS ||
      cards.some(n =>
        !Number.isInteger(n) || n < 1 || n > MAX_CARD_SLOTS
      ) ||
      new Set(cards).size !== cards.length
    ) {
      return json({
        success: false,
        error: "Invalid card selection."
      }, 400);
    }

    const myCards = Object.values(reservations)
      .filter(r => r.playerId === playerId);

    if (myCards.length + cards.length > MAX_CARDS) {
      return json({
        success: false,
        error: "Maximum 4 cards per player."
      }, 400);
    }

    for (const card of cards) {
      if (reservations[card]) {
        return json({
          success: false,
          error: `Card ${card} is already reserved.`
        }, 409);
      }
    }

    const existingPlayers = new Set(
      Object.values(reservations).map(r => r.playerId)
    );

    if (
      !existingPlayers.has(playerId) &&
      existingPlayers.size >= room.maxPlayers
    ) {
      return json({
        success: false,
        error: "Round is full."
      }, 409);
    }

    const total = cards.length * room.cardPrice;

    const player = await this.env.DB.prepare(`
      SELECT id, main_balance, bonus_balance
      FROM players
      WHERE id = ? AND telegram_id = ?
    `).bind(playerId, String(telegramId)).first();

    if (!player) {
      return json({
        success: false,
        error: "Player account not found."
      }, 404);
    }

    const bonus = Math.max(0, Number(player.bonus_balance || 0));
    const main = Math.max(0, Number(player.main_balance || 0));

    if (bonus + main < total) {
      return json({
        success: false,
        error: "Insufficient balance."
      }, 400);
    }

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
      return json({
        success: false,
        error: "Balance changed. Try again."
      }, 409);
    }

    const updatedReservations = { ...reservations };

    for (const cardSlot of cards) {
      updatedReservations[cardSlot] = {
        playerId,
        telegramId: String(telegramId),
        reservedAt: Date.now(),
        card: generateBingoCard()
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
      await this.ctx.storage.transaction(async txn => {
        await txn.put("reservations", updatedReservations);
        await txn.put("room", updatedRoom);
      });
    } catch (error) {
      await this.env.DB.prepare(`
        UPDATE players
        SET
          bonus_balance = COALESCE(bonus_balance, 0) + ?,
          main_balance = COALESCE(main_balance, 0) + ?,
          cards_count = MAX(
            0,
            COALESCE(cards_count, 0) - ?
          )
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
      FROM players WHERE id = ?
    `).bind(playerId).first();

    return json({
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

  async claim(request) {
    const { playerId, telegramId } = await request.json();

    if (!playerId || !telegramId) {
      return json({
        success: false,
        error: "Invalid player."
      }, 400);
    }

    const room = await this.ctx.storage.get("room");
    const reservations =
      await this.ctx.storage.get("reservations") || {};

    if (room.status !== "playing") {
      return json({
        success: false,
        error: room.winner
          ? "This round already has a winner."
          : "The game is not running."
      }, 409);
    }

    if (room.winner) {
      return json({
        success: false,
        error: "Too late! A winner was already confirmed."
      }, 409);
    }

    const myCards = Object.entries(reservations)
      .filter(([, item]) =>
        item.playerId === playerId &&
        item.telegramId === String(telegramId)
      );

    if (!myCards.length) {
      return json({
        success: false,
        error: "You have no cards in this round."
      }, 403);
    }

    const winningCard = myCards.find(([, item]) =>
      hasBingo(item.card, room.calledNumbers)
    );

    if (!winningCard) {
      return json({
        success: false,
        error: "No completed Bingo line found. Keep playing!"
      }, 400);
    }

    const player = await this.env.DB.prepare(`
      SELECT first_name, username
      FROM players WHERE id = ?
    `).bind(playerId).first();

    const winner = {
      playerId,
      telegramId: String(telegramId),
      name: player?.first_name || player?.username || "Player",
      card: Number(winningCard[0]),
      claimedAt: Date.now()
    };
const prizeAmount = Number(room.prizePool || 0);

if (!player || prizeAmount <= 0) {
  return json({
    success: false,
    error: "Winner payout could not be processed."
  }, 500);
}

await this.env.DB.batch([
  this.env.DB.prepare(`
    INSERT OR IGNORE INTO game_payouts
    (round_id, player_id, telegram_id, amount, paid_at, credited)
    VALUES (?, ?, ?, ?, ?, 0)
  `).bind(
    room.roundId,
    playerId,
    String(telegramId),
    prizeAmount,
    Date.now()
  ),

  this.env.DB.prepare(`
    UPDATE players
    SET main_balance = COALESCE(main_balance, 0) + (
      SELECT amount FROM game_payouts
      WHERE round_id = ? AND player_id = ? AND credited = 0
    )
    WHERE id = ? AND EXISTS (
      SELECT 1 FROM game_payouts
      WHERE round_id = ? AND player_id = ? AND credited = 0
    )
  `).bind(room.roundId, playerId, playerId, room.roundId, playerId),

  this.env.DB.prepare(`
    UPDATE game_payouts
    SET credited = 1
    WHERE round_id = ? AND player_id = ? AND credited = 0
  `).bind(room.roundId, playerId)
]);
    room.status = "finished";
    room.winner = winner;
    room.finishedAt = Date.now();
    room.winnerRevealEndsAt = Date.now() + 10000;

    // SAVE PLAYING HISTORY BEFORE ROUND RESET
    await this.saveRoundHistory(room, reservations);

    await this.ctx.storage.put("room", room);

    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.setAlarm(room.winnerRevealEndsAt);

    return json({
      success: true,
      winner,
      room,
      message: "BINGO! You are the first verified winner!"
    });
  }

  async announceNoWinner(reservations) {
    const telegramIds = [
      ...new Set(
        Object.values(reservations).map(item =>
          String(item.telegramId)
        )
      )
    ];

    const message =
      "🎮 BUNA BINGO — ROUND ENDED\n\n" +
      "All 75 numbers have been called, but no valid BINGO claim was made.\n\n" +
      "Thank you for playing! A new round will be ready shortly.";

    await Promise.allSettled(
      telegramIds.map(telegramId =>
        tg(this.env, "sendMessage", {
          chat_id: telegramId,
          text: message
        })
      )
    );
  }

  async resetRound() {
    const nextRoom = this.newRoom();

    await this.ctx.storage.transaction(async txn => {
      await txn.put("room", nextRoom);
      await txn.put("reservations", {});
      await txn.put("numberSequence", []);
    });

    await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    await this.ready;

    const room = await this.ctx.storage.get("room");

    if (!room) return;

    // WINNER REVEAL LASTS 10 SECONDS
    if (room.status === "finished") {
      if (
        room.winnerRevealEndsAt &&
        Date.now() >= room.winnerRevealEndsAt
      ) {
        await this.resetRound();
      }
      return;
    }

    // COUNTDOWN ENDS: START THE GAME
    if (
      room.status === "countdown" &&
      room.countdownEndsAt &&
      Date.now() >= room.countdownEndsAt
    ) {
      const sequence = shuffledNumbers();

      room.status = "playing";
      room.countdownEndsAt = null;
      room.startedAt = Date.now();
      room.calledNumbers = [];
      room.currentNumber = null;

      await this.ctx.storage.put("numberSequence", sequence);
      await this.ctx.storage.put("room", room);

      await this.callNextNumber();
      return;
    }

    if (room.status === "playing") {
      await this.callNextNumber();
    }
  }

  async callNextNumber() {
    const room = await this.ctx.storage.get("room");
    const sequence =
      await this.ctx.storage.get("numberSequence") || [];

    if (room.status !== "playing" || room.winner) return;

    if (!sequence.length) {
      room.status = "finished";
      room.finishedAt = Date.now();
      room.winnerRevealEndsAt = Date.now() + 10000;

      const reservations =
        await this.ctx.storage.get("reservations") || {};

      // SAVE HISTORY FOR A ROUND WITHOUT A WINNER
      await this.saveRoundHistory(room, reservations);

      await this.ctx.storage.put("room", room);
      await this.ctx.storage.setAlarm(room.winnerRevealEndsAt);

      await this.announceNoWinner(reservations);
      return;
    }

    const next = sequence.shift();

    room.currentNumber = next;
    room.calledNumbers = [...room.calledNumbers, next];

    await this.ctx.storage.put("numberSequence", sequence);
    await this.ctx.storage.put("room", room);

    if (sequence.length > 0) {
      await this.ctx.storage.setAlarm(
        Date.now() + CALL_INTERVAL_MS
      );
    } else {
      room.status = "finished";
      room.finishedAt = Date.now();
      room.winnerRevealEndsAt = Date.now() + 10000;

      const reservations =
        await this.ctx.storage.get("reservations") || {};

      // SAVE HISTORY FOR A ROUND WITHOUT A WINNER
      await this.saveRoundHistory(room, reservations);

      await this.ctx.storage.put("room", room);
      await this.ctx.storage.setAlarm(room.winnerRevealEndsAt);

      await this.announceNoWinner(reservations);
    }
  }
}
