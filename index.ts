import { App } from "@slack/bolt";
import http from "http";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// ---------------------------------------------------------------------------
// Trigger phrases used by the Polish sales team
// ---------------------------------------------------------------------------
const SALES_KEYWORDS =
  /zielone\s+[sś]wiat[łl]o|upsell|wpad[łl]o\s+zam[oó]wienie|podpisane\s+zam[oó]wienie|dorzucam|formularz\s+wpad[łl]|mamy\s+decyzj[eę]/i;

// ---------------------------------------------------------------------------
// Quotas – per person per month for 2026
// ---------------------------------------------------------------------------
const QUOTAS: Record<string, Record<string, number>> = {
  "Filip Sobel": {
    "2026-01": 104000, "2026-02": 104000, "2026-03": 104000,
    "2026-04": 112000, "2026-05": 112000, "2026-06": 120000,
    "2026-07": 128000, "2026-08": 136000, "2026-09": 144000,
    "2026-10": 160000, "2026-11": 176000, "2026-12": 200000,
  },
  "Michał Łaszkiewicz": {
    "2026-01": 52000, "2026-02": 52000, "2026-03": 52000,
    "2026-04": 56000, "2026-05": 56000, "2026-06": 60000,
    "2026-07": 64000, "2026-08": 68000, "2026-09": 72000,
    "2026-10": 80000, "2026-11": 88000, "2026-12": 100000,
  },
  "Łukasz Półchłopek": {
    "2026-01": 52000, "2026-02": 52000, "2026-03": 52000,
    "2026-04": 56000, "2026-05": 56000, "2026-06": 60000,
    "2026-07": 64000, "2026-08": 68000, "2026-09": 72000,
    "2026-10": 80000, "2026-11": 88000, "2026-12": 100000,
  },
  "Damian": {
    "2026-01": 52000, "2026-02": 52000, "2026-03": 52000,
    "2026-04": 56000, "2026-05": 56000, "2026-06": 60000,
    "2026-07": 64000, "2026-08": 68000, "2026-09": 72000,
    "2026-10": 80000, "2026-11": 88000, "2026-12": 100000,
  },
};

// salesData["2026-03"]["U123456"] = { total: 5000, deals: 2 }
const salesData: Record<string, Record<string, { total: number; deals: number }>> = {};

// ---------------------------------------------------------------------------
// Amount extraction
// ---------------------------------------------------------------------------
function parseK(raw: string): number | null {
  const m = raw.match(/^([\d]+(?:[,.]\d+)?)\s*k$/i);
  if (!m) return null;
  return Math.round(parseFloat(m[1].replace(",", ".")) * 1000);
}

function extractAmount(text: string): number | null {
  // 1. Upsell: "z 8k na 12k" → take the NEW (second) value
  const upsellMatch = text.match(
    /z\s+[\d]+(?:[,.]\d+)?\s*k?\s+na\s+([\d]+(?:[,.]\d+)?)\s*k\b/i
  );
  if (upsellMatch) {
    const val = parseK(upsellMatch[1] + "k");
    if (val) return val;
  }

  // 2. K-shorthand: "15k", "3,5k"
  const kMatch = text.match(/\b([\d]+(?:[,.]\d+)?)\s*k\b/i);
  if (kMatch) {
    const val = parseK(kMatch[1] + "k");
    if (val) return val;
  }

  // 3. Number + currency (handles "2997pln", "2997 pln", etc.)
  const currencyMatch = text.match(
    /\b([\d]{1,3}(?:[.,][\d]{3})*|[\d]+(?:[.,][\d]+)?)\s*(pln|zł|netto)\b/i
  );
  if (currencyMatch) {
    const raw = currencyMatch[1];
    const isThousands = /\d[.,]\d{3}$/.test(raw);
    const normalized = isThousands
      ? raw.replace(/[,.]/g, "")
      : raw.replace(",", ".");
    const num = parseFloat(normalized);
    if (!isNaN(num) && num > 0) return Math.round(num);
  }

  // 4. Standalone number ≥ 3 digits (fallback)
  const plainMatch = text.match(/\b(\d{3,})\b/);
  if (plainMatch) {
    const num = parseInt(plainMatch[1], 10);
    if (num > 0) return num;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getPolishMonthName(): string {
  const months = [
    "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
    "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień",
  ];
  return months[new Date().getMonth()];
}

function formatAmount(n: number): string {
  return n.toLocaleString("pl-PL", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function buildProgressBar(percent: number): string {
  const clamped = Math.min(percent, 100);
  const filled = Math.round(clamped / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

async function getDisplayName(userId: string): Promise<string> {
  try {
    const result = await app.client.users.info({ user: userId });
    const p = result.user?.profile;
    return p?.display_name || p?.real_name || result.user?.name || userId;
  } catch (err) {
    console.error(`[getDisplayName] error for ${userId}:`, err);
    return userId;
  }
}

function findQuota(displayName: string, monthKey: string): number | null {
  const dn = displayName.toLowerCase();
  for (const [name, months] of Object.entries(QUOTAS)) {
    const key = name.toLowerCase();
    const parts = key.split(" ");
    const firstName = parts[0];
    const lastName = parts[parts.length - 1];
    if (
      dn.includes(key) ||
      key.includes(dn) ||
      dn.includes(firstName) ||
      dn.includes(lastName)
    ) {
      return months[monthKey] ?? null;
    }
  }
  return null;
}

const CONGRATS = [
  "Świetna robota", "Brawo", "Gratulacje", "Niesamowite",
  "Doskonale", "To się nazywa sprzedaż", "Mistrzostwo", "Tak trzymać",
];

// ---------------------------------------------------------------------------
// Middleware – logs EVERY incoming message
// ---------------------------------------------------------------------------
app.use(async ({ payload, next }) => {
  const p = payload as Record<string, unknown>;
  if (p["type"] === "message" && !p["subtype"]) {
    const text = (p["text"] as string | undefined) ?? "";
    const user = p["user"] ?? "unknown";
    const channel = p["channel"] ?? "unknown";
    const triggered = SALES_KEYWORDS.test(text);
    const amount = extractAmount(text);
    console.log(
      `[MSG] channel=${channel} user=${user} triggered=${triggered} amount=${amount} text="${text}"`
    );
    SALES_KEYWORDS.lastIndex = 0;
  }
  await next();
});

// ---------------------------------------------------------------------------
// Sales deal handler
// ---------------------------------------------------------------------------
app.message(SALES_KEYWORDS, async ({ message, say }) => {
  try {
    const msg = message as {
      subtype?: string;
      user?: string;
      text?: string;
      ts: string;
      channel: string;
    };

    if (msg.subtype || !msg.user) return;

    const text = msg.text ?? "";
    const amount = extractAmount(text);

    console.log(`[DEAL] channel=${msg.channel} user=${msg.user} amount=${amount} text="${text}"`);

    if (!amount) {
      console.log(`[DEAL] Triggered but no amount found – skipping`);
      return;
    }

    const userId = msg.user;
    const displayName = await getDisplayName(userId);
    const monthKey = getMonthKey();

    // Ensure nested structure exists
    salesData[monthKey] ??= {};
    salesData[monthKey][userId] ??= { total: 0, deals: 0 };

    // Accumulate
    salesData[monthKey][userId].total += amount;
    salesData[monthKey][userId].deals += 1;

    const { total: newTotal, deals: dealCount } = salesData[monthKey][userId];

    const monthName = getPolishMonthName();
    console.log(
      `[DEAL] ${displayName} +${formatAmount(amount)} PLN → ${monthName} total: ${formatAmount(newTotal)} PLN (${dealCount} deals)`
    );

    const congrats = CONGRATS[Math.floor(Math.random() * CONGRATS.length)];
    const quota = findQuota(displayName, monthKey);

    const lines: string[] = [
      `🎉 ${congrats}, <@${userId}>!`,
      ``,
      `💰 Ten deal: *${formatAmount(amount)} PLN*`,
    ];

    const year = new Date().getFullYear();
    const monthLabel = `${monthName} ${year}`;

    if (quota) {
      const percent = Math.round((newTotal / quota) * 1000) / 10;
      const bar = buildProgressBar(percent);
      const diff = quota - newTotal;
      lines.push(
        `📊 Twój ${monthLabel}: *${formatAmount(newTotal)} PLN* / ${formatAmount(quota)} PLN (${percent}%)`,
        `${bar} ${percent}%`,
        `🔢 Liczba dealów: ${dealCount}`,
      );
      if (diff > 0) {
        lines.push(`🎯 Do celu brakuje: *${formatAmount(diff)} PLN*`);
      } else {
        lines.push(`🏆 Cel przekroczony o *${formatAmount(Math.abs(diff))} PLN*! Niesamowite!`);
      }
    } else {
      lines.push(
        `📊 Twój ${monthLabel}: *${formatAmount(newTotal)} PLN*`,
        `🔢 Liczba dealów: ${dealCount}`,
      );
    }

    await say({ text: lines.join("\n"), thread_ts: msg.ts });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    lastError = errMsg;
    console.error(`❌ [deal handler error] ${errMsg}`);
  }
});

// ---------------------------------------------------------------------------
// Health server
// ---------------------------------------------------------------------------
const HEALTH_PORT = Number(process.env.PORT ?? 3000);
const processStartedAt = new Date();
let botStatus: "starting" | "running" | "error" = "starting";
let botStartedAt: Date | null = null;
let lastError: string | null = null;

const healthServer = http.createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    const httpStatus = botStatus === "error" ? 503 : 200;
    const body = JSON.stringify({
      status: botStatus,
      uptime_seconds: botStartedAt
        ? Math.floor((Date.now() - botStartedAt.getTime()) / 1000)
        : null,
      last_error: lastError,
    });
    res.writeHead(httpStatus, { "Content-Type": "application/json" });
    res.end(body);
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

healthServer.listen(HEALTH_PORT, () => {
  console.log(`🌐 Health server listening on port ${HEALTH_PORT}`);
});

// ---------------------------------------------------------------------------
// Global error handlers
// ---------------------------------------------------------------------------
process.on("uncaughtException", (err) => {
  lastError = err.message;
  console.error("❌ [uncaughtException]", err.stack ?? err.message);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  lastError = msg;
  console.error("❌ [unhandledRejection]", msg);
});

app.error(async (error) => {
  lastError = error.message;
  console.error("❌ [bolt error]", error.message);
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
(async () => {
  try {
    await app.start();
    botStartedAt = new Date();
    botStatus = "running";
    lastError = null;

    const auth = await app.client.auth.test();
    console.log(`✅ Połączono jako: ${auth.user} (team: ${auth.team})`);
    console.log(`⚡ Slack sales bot działa w Socket Mode!`);
    console.log(`📋 Słowa kluczowe: ${SALES_KEYWORDS.toString()}`);

    // List joined channels
    try {
      const convs = await app.client.conversations.list({
        types: "public_channel",
        exclude_archived: true,
        limit: 200,
      });
      const joined = (convs.channels ?? []).filter((c: Record<string, unknown>) => c["is_member"]);
      if (joined.length === 0) {
        console.warn("⚠️  Bot NIE jest członkiem żadnego kanału! Zaproś: /invite @bot");
      } else {
        console.log(`📢 Bot jest w ${joined.length} kanale(ach)`);
      }
    } catch {}

  } catch (err) {
    botStatus = "error";
    lastError = err instanceof Error ? err.message : String(err);
    console.error("❌ Błąd startu:", lastError);
  }
})();
