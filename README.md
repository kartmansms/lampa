
<div align="center">
<h1> 🚀 Lampa Kartman Edition (LKE)</h1>
</div>

**Ссылка  на установку плагина**
```bibtex
 https://kartmansms.github.io/lampa/Shikimori/Shikimori.js
```
Данный код представляет собой плагин для медиа-приложения Lampа, который добавляет интеграцию с каталогом аниме Shikimori. Ключевых функциях:

🎨 Плагин интеграции с Shikimori для Lampa
Данный плагин добавляет в медиа-приложение Lampa полноценную поддержку каталога аниме Shikimori, предоставляя удобный доступ к информации, постерам, пользовательским спискам и авторизации.

🚀 Основные возможности
1. Инициализация и настройки
Защита от повторной загрузки – проверка флага window.plugin_shikimori_ready.
Управление настройками (ключ SETTINGS_KEY):
Язык отображения названий (title_language).
Фильтр взрослого контента (hide_adult).
Сортировка по умолчанию (default_sort).
Размер карточек.
Домен Shikimori (shiki_host).
Функция defaults() – возвращает значения настроек по умолчанию.

2. Работа с хранилищем (Storage)
storageGet(key, fallback) / storageSet(key, value) – универсальные обёртки для работы с Lampa.Storage (IndexedDB) и localStorage как fallback.

   - Отдельные ключи кеша для:
   - настроек,
   - жанров,
   - TMDB-данных,
   - постеров,
   - авторизации.

3. API и сетевые запросы
gqlQuery(query, callback, error) – выполнение GraphQL-запросов к Shikimori API.
apiGetJson(url, success, error) – универсальный GET-запрос с поддержкой Lampa.Network и jQuery AJAX.
apiRequestAuth(method, url, body, token, success, error) – запросы с авторизацией (Bearer token) для работы с пользовательскими списками.

4. Работа с постерами (ключевая цепочка)
Реализована многоступенчатая система получения постеров:
normalizePosterUrl(url) – нормализация URL:
обработка protocol-relative ссылок,
замена старых доменов (shikimori.one, .me, .club → .io),
преобразование относительных путей.
posterOf(data) – получение лучшего доступного постера из данных аниме.
resolveExternalPoster(data, callback) – основная функция разрешения внешнего постера через TMDB-прокси:

Проверка кеша постеров (POSTER_CACHE_KEY).
Проверка кеша TMDB.
Запрос к ARM API (arm.haglund.dev) для маппинга MAL → TMDB ID.
Прямой запрос к TMDB по ID.
Поиск по TMDB (multi-search) с умными запросами.
Deduplication запросов – параллельные запросы для одного animeId объединяются в очередь posterRequests.
installPosterFallback(img, urls, fallback, data) – установка fallback-логики на элемент изображения:
последовательная загрузка URL-адресов,
при ошибке – переход к следующему или внешнему разрешению.

5. Работа с названиями и локализация
titleOf(data) – получение отображаемого названия в зависимости от настройки языка (original / en / ru).
originalTitleOf(data) – получение вторичного (оригинального) названия.
Функции маппинга:
seasonName(), kindName(), statusName(), sortName() – преобразуют коды и слаг-идентификаторы в человекочитаемые названия (на русском).

6. Утилиты
extractYear(data) – извлечение года выпуска из данных аниме.
tmdbPosterUrl(path) – построение полного URL постера TMDB.
armLookupUrl(malId) – построение URL для ARM API.

7. Интеграция с Lampa
OAuth авторизация – поддержка авторизации для управления пользовательскими списками («смотрю», «просмотрено» и т.д.).
Внедрение в интерфейс – добавление оценки Shikimori и кнопки списка на полную страницу.
