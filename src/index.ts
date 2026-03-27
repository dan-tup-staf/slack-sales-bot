import { App } from "@slack/bolt";
import http from "http";
import { createClient } from "redis";

// ---------------------------------------------------------------------------
// Redis setup
// ---------------------------------------------------------------------------
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redis = createClient({ url: redisUrl });

redis.on("error", (err) => console.error("❌ Redis error:", err));

// ---------------------------------------------------------------------------
// Slack app
// ---------------------------------------------------------------------------
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
// Quotas – per person per month for 2026 (from your spreadsheet)
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

// ---------------------------------------------------------------------------
// Initial state from Google Sheets (March 2026 data)
// This will only be used if Redis is empty for that month
// ---------------------------------------------------------------------------
const INITIAL_STATE: Record<string, Record<string, { total: number; deals: number }>> = {
  "2026-01": {
    "Filip Sobel": { total: 169349, deals: 0 },
    "Michał Łaszkiewicz": { total: 16896, deals: 0 },
    "Łukasz Półchłopek": { total: 45476, deals: 0 },
    "Damian": { total: 67369, deals: 0 },
  },
  "2026-02": {
    "Filip Sobel": { total: 97322, deals: 0 },
    "Michał Łaszkiewicz": { total: 29625, deals: 0 },
    "Łukasz Półchłopek": { total: 14477, deals: 0 },
    "Damian": { total: 77602, deals: 0 },
  },
  "2026-03": {
    "Filip Sobel": { total: 118262, deals: 0 },
    "Michał Łaszkiewicz": { total: 43487, deals: 0 },
    "Łukasz Półchłopek": { total: 19976, deals: 0 },
    "Damian": { total: 64228, deals: 0 },
  },
};

// ---------------------------------------------------------------------------
// Name mapping: Slack display name → canonical name for quotas
// ---------------------------------------------------------------------------
const NAME_MAPPING: Record<string, string> = {
  "filip": "Filip Sobel",
  "sobel": "Filip Sobel",
  "wena": "Michał Łaszkiewicz",
  "michał": "Michał Łaszkiewicz",
  "łaszkiewicz": "Michał Łaszkiewicz",
  "łukasz": "Łukasz Półchłopek",
  "półchłopek": "Łukasz Półchłopek",
  "polchlopek": "Łukasz Półchłopek",
  "damian": "Damian",
};

function getCanonicalName(displayName: string): string | null {
  const dn = displayName.toLowerCase();
  for (const [key, canonical] of Object.entries(NAME_MAPPING)) {
    if (dn.includes(key)) {
      return canonical;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Redis helpers
// ---------------------------------------------------------------------------
async function getSalesData(monthKey: string, canonicalName: string): Promise<{ total: number; deals: number }> {
  const key = `sales:${monthKey}:${canonicalName}`;
  const data = await redis.get(key);
  
  if (data) {
    return JSON.parse(data);
  }
  
  // Check if we have initial state for this month/person
  const initial = INITIAL_STATE[monthKey]?.[canonicalName];
  if (initial) {
    // Save initial state to Redis
    await redis.set(key, JSON.stringify(initial));
    console.log(`[INIT] Loaded initial state for ${canonicalName} ${monthKey}: ${initial.total} PLN`);
    return initial;
  }
  
  return { total: 0, deals: 0 };
}

async function saveSalesData(monthKey: string, canonicalName: string, data: { total: number; deals: number }): Promise<void> {
  const key = `sales:${monthKey}:${canonicalName}`;
  await redis.set(key, JSON.stringify(data));
}

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

function findQuota(canonicalName: string, monthKey: string): number | null {
  return QUOTAS[canonicalName]?.[monthKey] ?? null;
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
    const canonicalName = getCanonicalName(displayName);
    const monthKey = getMonthKey();

    if (!canonicalName) {
      console.log(`[DEAL] Unknown user: ${displayName} – skipping quota tracking`);
      // Still respond but without quota info
      const congrats = CONGRATS[Math.floor(Math.random() * CONGRATS.length)];
      await say({
        text: `🎉 ${congrats}, <@${userId}>!\n\n💰 Ten deal: *${formatAmount(amount)} PLN*`,
        thread_ts: msg.ts,
      });
      return;
    }

    // Get current data from Redis (or initial state)
    const currentData = await getSalesData(monthKey, canonicalName);
    
    // Update
    currentData.total += amount;
    currentData.deals += 1;
    
    // Save to Redis
    await saveSalesData(monthKey, canonicalName, currentData);

    const { total: newTotal, deals: dealCount } = currentData;

    const monthName = getPolishMonthName();
    console.log(
      `[DEAL] ${canonicalName} +${formatAmount(amount)} PLN → ${monthName} total: ${formatAmount(newTotal)} PLN (${dealCount} deals via bot)`
    );

    const congrats = CONGRATS[Math.floor(Math.random() * CONGRATS.length)];
    const quota = findQuota(canonicalName, monthKey);

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
        `🔢 Liczba dealów (via bot): ${dealCount}`,
      );
      if (diff > 0) {
        lines.push(`🎯 Do celu brakuje: *${formatAmount(diff)} PLN*`);
      } else {
        lines.push(`🏆 Cel przekroczony o *${formatAmount(Math.abs(diff))} PLN*! Niesamowite!`);
      }
    } else {
      lines.push(
        `📊 Twój ${monthLabel}: *${formatAmount(newTotal)} PLN*`,
        `🔢 Liczba dealów (via bot): ${dealCount}`,
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
    // Connect to Redis first
    await redis.connect();
    console.log("✅ Redis połączony");

    await app.start();
    botStartedAt = new Date();
    botStatus = "running";
    lastError = null;

    const auth = await app.client.auth.test();
    console.log(`✅ Połączono jako: ${auth.user} (team: ${auth.team})`);
    console.log(`⚡ Slack sales bot działa w Socket Mode!`);
    console.log(`📋 Słowa kluczowe: ${SALES_KEYWORDS.toString()}`);
    console.log(`💾 Dane zapisywane w Redis`);

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
