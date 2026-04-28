# Slack Sales Bot 🎉

Bot śledzący deale sprzedażowe polskiego zespołu sales. Reaguje na wiadomości typu "zielone światło", "upsell", "podpisane zamówienie" i automatycznie liczy progres do miesięcznego celu.

## v3 – bez Redisa

Dane trzymane w pliku `data/sales.json`. Zero zewnętrznych zależności poza Slackiem.

## Funkcje

* 🎯 Rozpoznaje polskie frazy sprzedażowe
* 💰 Wyciąga kwoty z różnych formatów (15k, 3490 pln, 2,5k)
* 📊 Śledzi progres miesięczny per osoba
* 🏆 Pokazuje postęp do indywidualnej quoty

## Zmienne środowiskowe

```
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token
PORT=3000
```

## Deploy na Render (za darmo)

1. Połącz to repo z Render.com → New Web Service
2. Environment: **Docker**
3. Dodaj zmienne środowiskowe (Settings → Environment)
4. Instance type: **Free**
5. Render automatycznie zbuduje i uruchomi bota

> **Uwaga:** Render Free usypia serwis po 15 min bez ruchu. Bot w Socket Mode utrzymuje połączenie WebSocket ze Slackiem, więc powinien żyć. Jeśli Render mimo to usypia – dodaj healthcheck URL (`/health`) w ustawieniach Render.

## Konfiguracja Slack App

1. Włącz **Socket Mode** w Slack API → Socket Mode
2. Dodaj **Bot Token Scopes**:
   * `chat:write`
   * `channels:history`
   * `channels:read`
   * `users:read`
3. Zainstaluj app w workspace
4. Zaproś bota do kanału: `/invite @nazwa-bota`

## Trigger phrases

* "zielone światło" / "zielone swiatlo"
* "upsell"
* "wpadło zamówienie"
* "podpisane zamówienie"
* "dorzucam" + kwota
* "formularz wpadł"
* "mamy decyzję"

## Formaty kwot

* `15k` → 15 000 PLN
* `3,5k` → 3 500 PLN
* `3490 pln` / `3490pln` / `3490 zł` → 3 490 PLN
* `z 8k na 12k` → 12 000 PLN (upsell)
