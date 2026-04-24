# portal-consul-to-admin-converters

Набор одноразовых скриптов-мигрантов: забирают данные старого портала (формат JSON из Consul) и заливают их в новую админку на Strapi (`itwa-personal-account-admin`). Каждая папка — независимый импортер под конкретную сущность.

| Папка | Что импортит | Strapi content-type |
|---|---|---|
| `admin-benefits-converter` | Льготы / компенсации | `benefit`, `benefit-category` |
| `admin-customer-service-converter` | Вопросы в службу поддержки | `customer-service`, `customer-service-category` |
| `admin-events-converter` | События / мероприятия | `event`, `event-category` |
| `admin-news-converter` | Новости | `news-item` |
| `strapi-importer-info-blocks` | Инфо-блоки (алерты, подсказки, поля) | `info-block`, `info-block-code` |

## Общая архитектура

Все импортеры построены по одной схеме, с небольшими вариациями:

```
data.json (исходник)  →  convert-*.js  →  converted-*.json  →  publish.js  →  Strapi
```

- **convert-*.js** — чистая трансформация JSON без сетевых запросов: разделяет i18n-поля на `ru`/`en`, нормализует структуру под схемы Strapi, вытаскивает кнопки/ссылки в отдельные массивы, собирает справочники фича-флагов.
- **publish.js** — постит в Strapi. Обычно в два захода: `POST` RU-версии, затем `PUT /{id}?locale=en` для EN-локали того же documentId. Содержит задержки (100–200 мс) и свой `STRAPI_URL` + API-токен.

Исключение — `strapi-importer-info-blocks`: там трансформация и публикация объединены в один `import-to-strapi.js`, плюс используется `.env` вместо хардкода (ниже детали).

## Конфигурация и токены

Все импортеры используют **dotenv**. В каждой папке нужен свой `.env` с двумя переменными:

```
STRAPI_URL=https://itwa-stage-personal-account-admin.local.playrix.com
STRAPI_TOKEN=<api_token>
```

`STRAPI_URL` — базовый URL **без** `/api` на конце (скрипты сами добавляют `/api/...`). В `.env.example` каждой папки закомментированы варианты stage / localhost / prod — достаточно раскомментировать нужный.

При запуске скрипт падает с понятным сообщением, если переменные не заданы. Корневой `.gitignore` игнорирует `.env` во всём репозитории.

## Фича-флаги

Во всех импортерах фича-флаг в Strapi — это **реляция** (id в поле `featureFlag`), а не строка-код. Каждый `publish.js` при запуске:

1. Подтягивает существующие флаги из `/api/feature-flags?fields[0]=code` (с пагинацией) и строит `Map<code, id>`.
2. Перед каждым POST/PUT рекурсивно обходит payload (`resolveFeatureFlagsDeep`): для каждого ключа `featureFlag` со строковым значением подставляет id из кэша. Если резолв вернул `null`, ключ удаляется.
3. В конце печатает отчёт.

Глубокий обход важен: кнопки (`benefits.button`, `customer-service.button` и т.п.) — это компоненты со своей relation-ссылкой на `feature-flag`; у одного бенефита флаг может быть и сверху, и внутри каждой кнопки/ссылки/промо-кода.

Общая логика вынесена в `shared/feature-flags.js` (ESM-модуль) и подключается относительным импортом. `strapi-importer-info-blocks` использует собственную инлайн-копию тех же функций, потому что он CommonJS (разные module-системы нельзя сшить `import`-ом без плясок).

Поведение при отсутствии флага различается — оно управляется опцией `autoCreate` в `resolveFeatureFlagsDeep`:

| Импортер | Источник кода флага | Поведение при отсутствии в Strapi |
|---|---|---|
| benefits | `feat` / `strongFeat` на items/buttons/links/promo-codes (`strongFeat` приоритетнее) | **autoCreate: false** — warning, связь пустая, в сводке список missing-кодов |
| customer-service | `showFeat` на item или button | **autoCreate: false** — то же |
| events | `validator ≠ 1` → `<slug_name>_visible` | **autoCreate: true** — создаётся с полным `conditions` из `validator`, который лежит рядом с событием в `converted-events.json` |
| news | `validator ≠ 1` → `<slug_title>_visible` (fallback `news_<id>_visible` для кириллических заголовков) | **autoCreate: true** — то же самое, `validator` лежит рядом с новостью в `converted-news-stage.json` |
| info-blocks | `validator` (1 / 0 / object) | **autoCreate: true** — создаётся с полным `conditions` из `validator` |

**Почему benefits/customer-service не создают сами.** Исходный JSON у них содержит **только имя флага** (`"feat": "compensation__med_insurance"`), без правил видимости — условия живут где-то в другом конфиге старого портала. Автоматически создавать флаг с пустыми `conditions` опасно: это либо маскирует опечатку в коде (плодится дубликат), либо прячет факт, что флаг ещё не заведён в Strapi. Поэтому для этих двух мы только линкуем существующие; отсутствующие нужно завести руками в админке и перезапустить.

Для events и info-blocks валидатор идёт прямо рядом с записью, поэтому `conditions` собираются корректно и автосоздание безопасно.

---

## Импортеры

### 1. `admin-benefits-converter` — Льготы и компенсации

**Исходник:** `compensation-data.json`
Форма: `{ categoryKey: { name: {ru, en}, description: {ru, en}, items: [...] } }`. У item-ов могут быть вложенные items, кнопки, ссылки, промо-коды.

**Пайплайн:**
1. `node convert.js` → `compensation-data-converted.json` — раскладывает на локали, вытаскивает кнопки в `links`/`actions`, промо-коды из `extension.params.items` переносит в `actions` как компонент `benefits.promo-code`.
2. `node publish.js` — сначала POST-ит категории (`POST /api/benefit-categories`, затем `PUT ?locale=en`), затем льготы (`POST /api/benefits`, `PUT ?locale=en`). Льгота привязывается к категории через поле `category` (id).

**Фича-флаги:** `feat` / `strongFeat` на разных уровнях (включая кнопки-компоненты) → имя-код. На этапе `publish.js` строки рекурсивно резолвятся в id реляции; **отсутствующие в Strapi флаги не создаются автоматически** — печатается список missing-кодов, чтобы их завести руками в админке (с условиями) и перезапустить. Если `feat` оказался объектом, `convert.js` пишет warning и выкидывает его — такие случаи надо править на входе.

**Локали:** все двуязычные поля (`name`, `description`, текст кнопок) раскладываются на `ruText`/`enText`; RU постится, EN догружается PUT-ом. Кнопки с двуязычным текстом помечаются `hasOverridedText: true`.

**Примечания:** тип `button.type === 'link'` идёт в массив `links`, остальные (`compensation`, `network-access` и т.п.) — в `actions`. Есть `publish-customer-service.js` — вспомогательный скрипт; основной — `publish.js`.

---

### 2. `admin-customer-service-converter` — Служба поддержки

**Исходник:** `customer-service-data.json` (оригинал — `unmodified-customer-service-data.json`)
Форма: `{ categoryKey: { name: {ru, en}, items: [{ id?, taskId, name, description, examples, button | buttons }] } }`.

**Пайплайн:**
1. `node convert.js` → `converted-customer-service-data.json` — i18n split, нормализация `button → buttons`, `examples: string[] → строка через \n`.
2. `node publish.js` — `POST /api/customer-service-categories` + `PUT ?locale=en`, затем `POST /api/customer-services` + `PUT ?locale=en`. Привязка к категории через поле `category`.

**Дедупликация:** items с одинаковым `serviceId` мерджатся — кнопки объединяются в один item. Items без `serviceId` идут как отдельные. Если дубликат приходит с другим `showFeat` на кнопке, он может переопределить `featureFlag`.

**Фича-флаги:** `showFeat` на уровне item или кнопки → имя-код. `publish.js` резолвит строку в id реляции; отсутствующие флаги **не создаются автоматически** — печатается список missing-кодов, заводить руками в админке и перезапускать.

**Примечания:** кнопки помечаются `__component: "customer-service.button"`; типы нормализуются (`network-access` → `network_access`). Файлы `index.js`, `news-publish.js` — вспомогательные/неиспользуемые.

---

### 3. `admin-events-converter` — События

**Исходник:** `events.json` — массив объектов со полями `name {ru,en}`, `startDate`, `endDate`, `category {name {ru,en}, color}`, `format`, `validator`, `cancelled`, `photoLink`, `image`.

**Пайплайн:**
1. `node convert-events.js` → три файла:
   - `converted-categories.json` — уникальные категории с нормализованным цветом (мажоритарный выбор, если цвета различаются) и фиксом опечатки `Eduacational → Educational`.
   - `converted-events.json` — события с разбиением даты/времени (`startDate`, `endDate`, `startTime` в ISO + `.000`).
2. `node publish.js` — постит категории (`POST /api/event-categories` + `PUT ?locale=en`), затем события (`POST /api/events` + `PUT ?locale=en`). Категории резолвятся по EN-имени (маппинг строится динамически). Задержка 200 мс между вызовами. Окружение (stage/prod/local) выбирается через `STRAPI_URL` в `.env`.

**Фича-флаги:** у каждого события в `converted-events.json` сохраняется `validator` рядом с парами `ru`/`en`. `publish.js` строит `validatorsByCode` в памяти из самих записей — отдельного справочника-файла нет (источник правды — Strapi). При публикации код резолвится в id, при отсутствии в Strapi флаг создаётся автоматически с полными `conditions` из `validator` (обычно `studio.id`).

---

### 4. `admin-news-converter` — Новости

**Исходник:** `news.json` (основной), `stage-news.json` (для перегенерации под stage).
Форма: массив `{ id, title {ru,en}, announcement {ru,en}, text {ru,en}, author {ru,en}, date, channel {name, color}, validator, pinned, image, link, photoLink }`.

**Пайплайн:**
1. `node convert-news.js` → `converted-news-stage.json` — читает **из `stage-news.json`**, раскладывает локали, форматирует дату в `YYYY-MM-DD`. Канал пробрасывается объектом `{ name, color }` (id резолвится на публикации). Если `validator ≠ 1`, рядом с записью сохраняется сам `validator` — чтобы `publish.js` мог собрать из него `conditions` при создании флага.
2. `node publish.js` — перед публикацией прогревает кэш флагов, прогревает/сидит slack-каналы, затем `POST /api/news` (RU), `PUT /api/news/{id}?locale=en` (EN).

**Slack-каналы.** Хардкод-маппинга больше нет. `ensureSlackChannels()` на старте:
1. Тянет существующие каналы из `/api/slack-channels?fields[0]=name` (с пагинацией) и строит `Map<name, id>`.
2. Из `converted-news-stage.json` собирает уникальные `{ name, color }` и для каждого отсутствующего в кэше делает `POST /api/slack-channels` с `name` и `color` из исходника — id попадает в кэш.
3. Перед POST/PUT каждой новости `resolveChannel` заменяет объект `{ name, color }` на числовой id. Если создать канал не удалось — поле `channel` удаляется из payload.

**Фича-флаги:** логика совпадает с events. `getFeatureFlagCode(entry)` в `convert-news.js`:
- `validator === 1` → `null` (универсальная новость);
- иначе `<slug>_visible`, где `slug = slugify(title.en || title.ru)`, а если после `slugify` (lowercase + `[^a-z0-9] → _` + обрезка `_` по краям) осталась пустая строка (кириллический заголовок) — fallback на `news_<id>`.

`publish.js` строит `validatorsByCode` из самих записей и через `resolveFeatureFlagsDeep` (из `shared/feature-flags.js`) резолвит строку в id; отсутствующий флаг создаётся автоматически с `conditions`, построенным из сохранённого рядом `validator`.

**Примечания:** поле `image` захардкожено как `1` (id), фактическая ссылка на картинку в output не пробрасывается. Для отсутствующих локалей контент заполняется плейсхолдером `[locale] field_name`.

---

### 5. `strapi-importer-info-blocks` — Инфо-блоки

Единственный импортер, который объединяет конвертацию и публикацию в одном скрипте (автосоздание недостающих фича-флагов теперь есть и в events/news — см. таблицу выше).

**Исходник:** `data.json` — `{ section: { blockCode: [ { validator, title, blocks, typeAlert?, withIcon? } ] } }`, где `section` ∈ `alert | field | hint | info`.

**Запуск:**
```bash
npm install
# заполнить .env (STRAPI_URL, STRAPI_TOKEN) — см. .env.example
npm run import        # node import-to-strapi.js
npm run delete        # node delete-from-strapi.js
```

**Пайплайн внутри `import-to-strapi.js`:**
1. Читает `data.json`.
2. `fetchAllFeatureFlags()` — с пагинацией тянет `/api/feature-flags?fields[0]=code`, собирает `Map<code, id>`.
3. По секциям обходит блоки, для каждого:
   - Получает или создаёт запись в `/api/info-block-codes` (один код на `blockCode`, результат кэшируется).
   - `generateFeatureFlag(blockCode, validator)` строит строку-код (`{blockCode}__disabled` / `{blockCode}__legal_entity-<slug>_and_studio-<slug>` и т.п.). Префикс `!` превращается в `not_`.
   - `generateTitleFromValidator(..., 'ru'|'en')` строит человекочитаемый заголовок (`payout_dates (для playrix_cyprus)`).
   - `getOrCreateFeatureFlagId({ code, title, validator })` — если id есть в кэше → вернуть; иначе `POST /api/feature-flags` с полями `code`, `title`, `conditions`. Поле `conditions` (custom-field `plugin::feature-flag-conditions.conditions`) собирается из валидатора функцией `buildConditionsFromValidator`:
     - `0` → `{ availability: 'none', branches: [] }`
     - `1`/undefined → `{ availability: 'all', branches: [] }`
     - объект → `{ availability: 'conditional', branches: [{ rows: [{ kind: 'predicate', attribute, negate, values }] }] }`; ключи валидатора (`legal_entity.id`, `studio.id`, `contract_type`) маппятся на UI-атрибуты (`legal_entity`, `studio`, `contract_type`).
   - Генерирует уникальный заголовок инфо-блока (с суффиксом `(N)` при коллизии).
   - `POST /api/info-blocks?locale=ru`, потом `POST /api/info-blocks?locale=en` — каждая локаль создаётся отдельной записью. В поле `featureFlag` кладётся id полученного/созданного флага.

**Локали:** RU и EN создаются **двумя отдельными POST**-ами (в отличие от остальных импортеров, где EN идёт PUT-ом). Контент конвертируется из кастомного blocks-формата в markdown функцией `blocksToMarkdown` с поддержкой `span/div/strong/b/a/br/binding-list/ordered-list`.

**Связи:**
- `blockCode` → запись в `info-block-code` (id).
- `featureFlag` → запись в `feature-flag` (id), может быть создана на лету.

**Итоговая сводка** печатает: сколько инфо-блоков создано, сколько блок-кодов использовано, сколько фича-флагов в кэше, список только что созданных флагов.

---

## Порядок запуска при полной миграции

Строгих зависимостей между импортерами нет, но если хочется разумного порядка — сначала справочники/категории, потом контент:

1. `admin-events-converter` (категории событий)
2. `admin-benefits-converter` (категории льгот)
3. `admin-customer-service-converter` (категории поддержки)
4. `strapi-importer-info-blocks` (info-block-codes + feature-flags + info-blocks)
5. `admin-news-converter` (новости — slack-каналы сидятся сами из исходника, так что внешних зависимостей нет)

Для каждой папки: `npm install` (где есть `package.json`), затем `node convert*.js` → `node publish.js` (или `npm run import` для info-blocks).
