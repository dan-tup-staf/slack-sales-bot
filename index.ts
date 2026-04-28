import { App } from "@slack/bolt";
import http from "http";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// JSON file persistence (replaces Redis)
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "sales.json");

type SalesEntry = { total: number; deals: number };
type SalesStore = Record<string, Record<string, SalesEntry>>;

function loadStore(): SalesStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("⚠️ Błąd odczytu sales.json, zaczynam od INITIAL_STATE:", err);
  }
  return structuredClone(INITIAL_STATE);
}

function saveStore(store: SalesStore): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
}

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
// Maksymy / Cytaty
// ---------------------------------------------------------------------------
const MAXIMS = [
  // Sun Tzu
  "Najwyższym osiągnięciem jest pokonanie wroga bez walki.",
  "Zwycięscy wojownicy najpierw wygrywają, a potem idą na wojnę; pokonani najpierw idą na wojnę, a potem szukają zwycięstwa.",
  "Poznaj swojego wroga i poznaj samego siebie, a w stu bitwach nie zaznasz porażki.",
  "Planuj to, co trudne, dopóki jest łatwe; rób to, co wielkie, dopóki jest małe.",
  "Strategia bez taktyki to najwolniejsza droga do zwycięstwa. Taktyka bez strategii to zgiełk przed porażką.",
  "Cała sztuka wojny opiera się na oszustwie.",
  "Kiedy jesteś zdolny do ataku, sprawiaj wrażenie niezdolnego; kiedy używasz sił, sprawiaj wrażenie nieaktywnego.",
  "Pojawiaj się tam, gdzie cię nie oczekują; uderzaj tam, gdzie nie są przygotowani.",
  "Bądź szybki jak wiatr, powolny jak las, agresywny jak ogień i nieruchomy jak góra.",
  "Niech twoje plany będą mroczne i nieprzeniknione jak noc, a kiedy uderzasz, spadaj jak piorun.",
  "Unikaj tego, co silne, a uderzaj w to, co słabe.",
  "W samym środku chaosu kryje się okazja.",
  "Woda dostosowuje swój bieg do gruntu, po którym płynie; żołnierz wypracowuje zwycięstwo w odniesieniu do przeciwnika.",
  "Nie ma przykładu narodu, który skorzystałby na długotrwałej wojnie.",
  "Zmuś przeciwnika do podjęcia walki tam, gdzie ty chcesz, i wtedy, kiedy ty chcesz.",
  "Traktuj swoich ludzi jak ukochanych synów, a pójdą za tobą w najgłębsze doliny.",
  "Generał, który maszeruje naprzód nie pragnąc sławy i wycofuje się nie bojąc się hańby, jest skarbem królestwa.",
  "Jeśli rozkazy są jasne, a żołnierze mimo to nie słuchają, wina leży po stronie oficerów.",
  "Największym błędem jest lekceważenie przeciwnika.",
  "Kto wie, kiedy może walczyć, a kiedy nie – zwycięży.",
  // Robert Cialdini
  "Ludzie nie kupują Twoich produktów, kupują Twoją wiarygodność.",
  "Reguła wzajemności jest tak silna, że potrafi wymusić zgodę nawet na prośbę, która byłaby odrzucona.",
  "Jesteśmy najbardziej skłonni ulec komuś, kogo lubimy – a lubimy tych, którzy są do nas podobni.",
  "Najskuteczniejszym sposobem na przekonanie kogoś jest pokazanie, że inni już to robią.",
  "Rzeczy stają się bardziej atrakcyjne w naszych oczach w miarę, jak stają się mniej dostępne.",
  "Często nie podejmujemy decyzji na podstawie wszystkich informacji, lecz na podstawie jednego wyzwalacza.",
  "Zobowiązanie podjęte publicznie staje się więzieniem, z którego rzadko chcemy uciec.",
  "Jeśli chcesz, aby ktoś Ci pomógł, najpierw daj mu coś od siebie.",
  "Strata boli nas bardziej, niż cieszy nas zysk o tej samej wartości.",
  "Ekspertyza to nie tylko wiedza, to sposób, w jaki prezentujesz się światu.",
  "To, na czym skupiamy uwagę, wydaje nam się ważniejsze tylko dlatego, że na tym się skupiamy.",
  "Proces perswazji nie zaczyna się od argumentów, ale od przygotowania gruntu pod ich przyjęcie.",
  "Zadaj odpowiednie pytanie na początku rozmowy, a ustawisz mentalne ramy dla dalszej dyskusji.",
  "Ludzie wierzą, że to, co przykuwa ich uwagę, jest przyczyną zdarzeń.",
  "Najlepszy negocjator sprawia, że druga strona czuje się mądra, zanim padnie oferta.",
  "Prawdziwy autorytet nie potrzebuje siły; potrzebuje dowodów na kompetencję i uczciwość.",
  "Przyznanie się do małej słabości na początku buduje gigantyczne zaufanie do wielkich zalet.",
  "Wpływ to nie manipulacja; to umiejętność wydobycia na światło dzienne argumentów.",
  "Najtrudniej jest przekonać kogoś do zmiany, jeśli uderza ona w jego poczucie tożsamości.",
  // Ferdynand Kiepski
  "W tym kraju nie ma pracy dla ludzi z moim wykształceniem.",
  "Zarobić, żeby się nie narobić.",
  "Halinka, śpisz? Bo mi się koncepcja narodziła!",
  "Pośredniak to jest instytucja do upodlania uczciwego bezrobotnego.",
  "Paździoch to jest menda i pasożyt społeczny.",
  "Panie Boczek, pan masz umysł jak dziecko, tylko w tym tłuszczu zatopiony.",
  "Są na świecie rzeczy, o których się fizjologom nie śniło.",
  "Nie będzie mi tu obcy element po korytarzu grasował!",
  "Dobra flaszka nie jest zła.",
  "Mocny Full to jest napój bogów.",
  "Człowiek nie jest wielbłąd, pić musi.",
  "Ja jestem człowiek kulturalny, tylko sytuacja mnie zmusza do chamstwa.",
  "Życie to jest pasmo udręk i upokorzeń, przeplatane krótkimi chwilami przy piwie.",
  "Halinka, nie bądź taka agresywna, bo ci żyłka pęknie!",
  "Ja mam prawo do odpoczynku po ciężkim dniu nicnierobienia.",
  "Co ty mi tu będziesz o kulturze mówiła, jak ty mi skarpetek nie wyprałaś!",
  "Jeden bystry człowiek w tym domu wystarczy, i to jestem ja.",
  "Babka! Gdzie masz rentę?!",
];

// ---------------------------------------------------------------------------
// Emoji
// ---------------------------------------------------------------------------
const EMOJIS = ["💚", "🟢", "🟩", "🟠", "✅", "🤑"];

function getRandomEmoji(): string {
  return EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
}

function getRandomMaxim(): string {
  return MAXIMS[Math.floor(Math.random() * MAXIMS.length)];
}

// ---------------------------------------------------------------------------
// Initial state from Google Sheets (historical data)
// ---------------------------------------------------------------------------
const INITIAL_STATE: SalesStore = {
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

// Load store at startup
let store = loadStore();

// ---------------------------------------------------------------------------
// Name mapping: Slack display name → canonical name
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
// Store helpers (replaces Redis get/set)
// ---------------------------------------------------------------------------
function getSalesData(monthKey: string, canonicalName: string): SalesEntry {
  const monthData = store[monthKey];
  if (monthData?.[canonicalName]) {
    return monthData[canonicalName];
  }

  const initial = INITIAL_STATE[monthKey]?.[canonicalName];
  if (initial) {
    if (!store[monthKey]) store[monthKey] = {};
    store[monthKey][canonicalName] = { ...initial };
    saveStore(store);
    console.log(`[INIT] Loaded initial state for ${canonicalName} ${monthKey}: ${initial.total} PLN`);
    return store[monthKey][canonicalName];
  }

  return { total: 0, deals: 0 };
}

function updateSalesData(monthKey: string, canonicalName: string, amount: number): SalesEntry {
  if (!store[monthKey]) store[monthKey] = {};
  if (!store[monthKey][canonicalName]) {
    const initial = INITIAL_STATE[monthKey]?.[canonicalName];
    store[monthKey][canonicalName] = initial ? { ...initial } : { total: 0, deals: 0 };
  }

  store[monthKey][canonicalName].total += amount;
  store[monthKey][canonicalName].deals += 1;
  saveStore(store);

  return store[monthKey][canonicalName];
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
  const upsellMatch = text.match(
    /z\s+[\d]+(?:[,.]\d+)?\s*k?\s+na\s+([\d]+(?:[,.]\d+)?)\s*k\b/i
  );
  if (upsellMatch) {
    const val = parseK(upsellMatch[1] + "k");
    if (val) return val;
  }

  const kMatch = text.match(/\b([\d]+(?:[,.]\d+)?)\s*k\b/i);
  if (kMatch) {
    const val = parseK(kMatch[1] + "k");
    if (val) return val;
  }

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

    const emoji = getRandomEmoji();
    const maxim = getRandomMaxim();
    const congrats = CONGRATS[Math.floor(Math.random() * CONGRATS.length)];

    if (!canonicalName) {
      console.log(`[DEAL] Unknown user: ${displayName} – responding without monthly tracking`);
      const lines = [
        `${emoji} ${congrats}, <@${userId}>!`,
        ``,
        `${emoji} Ten deal: *${formatAmount(amount)} PLN*`,
        ``,
        `_"${maxim}"_`,
      ];
      await say({ text: lines.join("\n"), thread_ts: msg.ts });
      return;
    }

    const { total: newTotal, deals: dealCount } = updateSalesData(monthKey, canonicalName, amount);

    const monthName = getPolishMonthName();
    const year = new Date().getFullYear();

    console.log(
      `[DEAL] ${canonicalName} +${formatAmount(amount)} PLN → ${monthName} ${year} total: ${formatAmount(newTotal)} PLN (${dealCount} deals)`
    );

    const lines = [
      `${emoji} ${congrats}, <@${userId}>!`,
      ``,
      `${emoji} Ten deal: *${formatAmount(amount)} PLN*`,
      `${emoji} Twój ${monthName} ${year}: *${formatAmount(newTotal)} PLN*`,
      `${emoji} Liczba dealów: ${dealCount}`,
      ``,
      `_"${maxim}"_`,
    ];

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
    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    console.log(`💾 Dane w pliku: ${DATA_FILE}`);
    console.log(`📦 Załadowano ${Object.keys(store).length} miesięcy danych`);

    await app.start();
    botStartedAt = new Date();
    botStatus = "running";
    lastError = null;

    const auth = await app.client.auth.test();
    console.log(`✅ Połączono jako: ${auth.user} (team: ${auth.team})`);
    console.log(`⚡ Slack sales bot działa w Socket Mode!`);
    console.log(`📋 Słowa kluczowe: ${SALES_KEYWORDS.toString()}`);
    console.log(`📝 Maksym załadowanych: ${MAXIMS.length}`);

  } catch (err) {
    botStatus = "error";
    lastError = err instanceof Error ? err.message : String(err);
    console.error("❌ Błąd startu:", lastError);
  }
})();
