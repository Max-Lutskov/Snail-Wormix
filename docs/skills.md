# Скіли та плагіни проєкту

Усе встановлено на рівні проєкту: скіли лежать у `.claude/skills/`, плагіни увімкнені в
`.claude/settings.json`. Знімок зроблено 2026-11-02.

## Як перевіряли

- Беремо тільки офіційні або відомі джерела (видавець рушія/інструмента, Anthropic, репо з тисячами зірок).
- Для кожного скіла переглянули файли. Скрипти є лише в superpowers: `find-polluter.sh` прочитано
  повністю й залишено, скрипти `brainstorming` прочитано й видалено (див. нижче).
- По всіх markdown пройшлися пошуком: зовнішні URL (знайдено лише посилання на документацію та
  приклади на кшталт `cdn.example.com`), команди встановлення, ключі/токени, prompt-injection.
  Нічого підозрілого.
- Phaser-скіли — це довідка API від самих Phaser Studio (~0.5 МБ markdown). Їх перевірено
  скануванням, а не прочитано рядок за рядком.

## Плагіни (маркетплейс `claude-plugins-official`, Anthropic)

| Плагін | Навіщо | Примітка |
|---|---|---|
| `typescript-lsp` | Діагностика типів і навігація по TS | Потрібен `typescript-language-server` у PATH: `npm i -g typescript typescript-language-server` (ще не встановлено) |
| `context7` | Актуальна документація Phaser / Vite / Capacitor | MCP на `mcp.context7.com` (Upstash): запити про бібліотеки йдуть на їхній сервер. Код проєкту туди не надсилається, лише запити |
| `playwright` | Смоук-тести в браузері, огляд гри очима агента | Запускає `npx @playwright/mcp@latest` (Microsoft) |
| `commit-commands` | `/commit`, `/commit-push-pr` | |
| `pr-review-toolkit` | Рев'ю коду, тестів, типів, тихих помилок | |
| `code-simplifier` | Рефакторинг/спрощення | |
| `feature-dev` | `/feature-dev`: дослідження → архітектура → реалізація | |

## Скіли

### Phaser 4 — [phaserjs/phaser/skills](https://github.com/phaserjs/phaser/tree/master/skills) (MIT, коміт `02d8931`)

Офіційні, під Phaser 4. Взято 19 із 28:

`game-setup-and-config`, `scenes`, `graphics-and-shapes`, `render-textures` (руйнівна земля),
`sprites-and-images`, `loading-assets`, `input-keyboard-mouse-touch`, `cameras`,
`scale-and-responsive`, `tweens`, `particles`, `time-and-timers`, `text-and-bitmaptext`,
`animations`, `audio-and-sound`, `events-system`, `geometry-and-math`, `groups-and-containers`,
`v4-new-features`.

Не взяли: `physics-arcade`, `physics-matter` (фізика своя, у `src/core/`), `tilemaps`,
`v3-to-v4-migration`, `data-manager`, `curves-and-paths`, `filters-and-postfx`,
`game-object-components`, `actions-and-utilities`. За потреби докинемо.

### Геймдев — [gamedev-skills/awesome-gamedev-agent-skills](https://github.com/gamedev-skills/awesome-gamedev-agent-skills) (Apache-2.0, ~6.4k ★, коміт `19d93f9`)

| Скіл | Навіщо |
|---|---|
| `game-feel` | Juice: тряска камери, hit-stop, squash & stretch — для вибухів і влучань |
| `physics-tuning` | Фіксований крок, інтерполяція рендеру, тунелювання снарядів |
| `performance-optimization` | Профілювання, пули, бюджет кадру (ціль — 60 FPS на Android) |
| `game-ui-ux` | HUD, safe area на телефонах, стек екранів, HUD через події |

Приклади коду в них переважно на Godot/Unity, але принципи загальні. Не взяли: роутер (тягне
скіли інших рушіїв), `phaser-core` і `camera-systems` (дублюють офіційні Phaser-скіли),
`input-systems` (геймпади/платформери — не наш випадок), жанри (артилерії серед них немає).

### Vite / Vitest — [antfu/skills](https://github.com/antfu/skills) (MIT, ~6k ★, коміт `7de210b`)

| Скіл | Навіщо |
|---|---|
| `vite` | Конфіг Vite 8 (Rolldown), плагіни |
| `vitest` | Тести core-логіки: API, моки, coverage, фікстури |

Згенеровані з офіційної документації Vite/Vitest.

### Процес — [obra/superpowers](https://github.com/obra/superpowers) (MIT, ~310k ★, коміт `2ce8aa1`)

| Скіл | Навіщо |
|---|---|
| `test-driven-development` | TDD для core-механік (правило «кожна механіка з тестами») |
| `systematic-debugging` | Пошук першопричини замість латок |
| `verification-before-completion` | Не казати «готово» без запущених тестів/збірки |
| `receiving-code-review` | Як обробляти зауваження рев'ю |
| `brainstorming` | Обговорення механік і дизайну перед кодом |

**Змінено проти оригіналу:**
- `brainstorming`: видалено `scripts/` і `visual-companion.md`. Локальний сервер компаньйона
  вставляє на сторінку логотип з `primeradiant.com` (сторонній сервер, телеметрія) — це суперечить
  правилам `CLAUDE.md`. Розділи про компаньйон прибрано з `SKILL.md`; перехід після дизайну веде
  в plan mode або `/feature-dev` замість `writing-plans`; дизайн-доки пишуться в `docs/specs/`.
- `systematic-debugging`: прибрано префікс `superpowers:` у посиланнях на інші скіли.
- Не взяли `writing-plans`, `executing-plans`, `subagent-driven-development`: тягнуть за собою
  всю екосистему superpowers (свої скрипти, worktrees, багато сабагентів). Їхню роль закриває
  plan mode + `feature-dev`.

## Не знайдено

Якісних скілів із відомих джерел не знайшлося для:

- **Capacitor** — пошук нічого не дав; поки є документація через `context7`.
- **Суворий TypeScript / архітектура** — окремих скілів немає; правила вже в `CLAUDE.md`,
  перевірку типів дає `typescript-lsp`, рев'ю — `pr-review-toolkit` (`type-design-analyzer`).
- **Руйнівна земля, балістика з вітром** — немає. Є `render-textures` для рендеру.
- **Мультиплеєр з авторитетним сервером / Colyseus** — немає.
- **Ігровий баланс, артилерійський жанр** — немає.

План: свої скіли (наприклад, `destructible-terrain`, `deterministic-core`) напишемо, коли дійдемо
до цих механік і буде з чого взяти перевірені рішення, а не наперед.

## Інше з `D:\` (інші проєкти)

Переглянули `.claude/skills` в інших проєктах. Звідти корисні лише скіли superpowers, і їх взято
свіжими з першоджерела. Nuxt/Vue/SEO/копірайтинг до гри не стосуються. `webapp-testing`
(Anthropic) пише тести на Python — у нас Playwright через MCP і TypeScript, тому не взяли.
