/**
 * Shikimori Plugin for Lampa v3.2.0
 *
 * Интеграция базы данных аниме Shikimori для медиа-центра Lampa.
 * Каталог, поиск, фильтры, сезоны, списки пользователя, карточки полной страницы.
 *
 * Возможности:
 * - Каталог Shikimori API с пагинацией, фильтрами и сортировкой
 * - Цепочка постеров: Shikimori → кеш TMDB → ARM lookup → поиск TMDB
 * - Поддержка TMDB прокси через Lampa.TMDB.api() / Lampa.TMDB.image() для РФ
 * - OAuth авторизация для списков пользователя (смотрю, просмотрено и т.д.)
 * - Внедрение оценки Shikimori и кнопки списка на полную страницу
 * - Навигация ТВ-пулем с восстановлением фокуса
 * - Настройки: язык, размер карточек, домен Shikimori
 *
 * @author kartmansms
 * @license MIT
 */

(function () {
    'use strict';

    if (window.plugin_shikimori_ready) return;
    window.plugin_shikimori_ready = true;

    var SETTINGS_KEY = 'shikimori_settings_v2';
    var GENRES_CACHE_KEY = 'shikimori_genres_cache_v1';
    var TMDB_CACHE_KEY = 'shikimori_tmdb_cache_v1';
    var POSTER_CACHE_KEY = 'shikimori_poster_cache_v1';
    var AUTH_KEY = 'shikimori_auth_v1';

    var ARM_HOST = 'https://arm.haglund.dev';
    var TMDB_API_KEY = '4ef0d7355d9ffb5151e987764708ce96';
    var PAGE_LIMIT = 48;

    var adultGenres = { hentai: true, erotica: true, yaoi: true, yuri: true };
    var posterRequests = {};
    var fullResolveCache = {};
    var fullPollId = null;

    // ─── GraphQL Helper ──────────────────────────────────────────────

    function gqlQuery(query, callback, error) {
        var url = getShikiHost() + '/api/graphql';
        var body = JSON.stringify({ query: query });

        $.ajax({
            url: url,
            method: 'POST',
            contentType: 'application/json',
            dataType: 'json',
            timeout: 12000,
            headers: { 'User-Agent': 'LampaShikimoriPlugin' },
            data: body,
            success: function (res) {
                if (res && res.errors && res.errors.length) {
                    if (error) error(res.errors[0].message);
                    else callback(null);
                    return;
                }
                callback(res && res.data ? res.data : null);
            },
            error: function (xhr) {
                if (error) error(xhr);
                else callback(null);
            }
        });
    }

    function defaults() {
        return {
            title_language: 'original',
            hide_adult: true,
            default_sort: 'popularity',
            card_size: 'normal',
            shiki_host: 'https://shikimori.io'
        };
    }

    // ─── Storage Helpers ───────────────────────────────────────────────

    /**
     * Чтение значения из Lampa.Storage с fallback на localStorage.
     *
     * Поддерживает два бэкенда:
     * - Lampa.Storage (IndexedDB + localStorage через Lampa API)
     * - Прямой localStorage (fallback для случая если Lampa ещё не загружена)
     *
     * @param {string} key - Ключ хранилища (напр. 'shikimori_settings_v2')
     * @param {*} fallback - Значение по умолчанию если ключ не найден
     * @returns {*} Сохранённое значение или fallback
     *
     * @example
     * var settings = storageGet('shikimori_settings_v2', {});
     * var genres = storageGet('shikimori_genres_cache_v1', []);
     */
    function storageGet(key, fallback) {
        var value;

        try {
            if (window.Lampa && Lampa.Storage && Lampa.Storage.get) {
                value = Lampa.Storage.get(key, fallback);
                return value === undefined || value === null ? fallback : value;
            }
        } catch (e) {}

        try {
            var raw = localStorage.getItem(key);
            if (raw) {
                try {
                    return JSON.parse(raw);
                } catch (e) {
                    return fallback;
                }
            }
            return fallback;
        } catch (err) {
            return fallback;
        }
    }

    /**
     * Запись значения в Lampa.Storage с fallback на localStorage.
     * @param {string} key - Ключ хранилища
     * @param {*} value - Значение для сохранения
     */
    function storageSet(key, value) {
        try {
            if (window.Lampa && Lampa.Storage && Lampa.Storage.set) {
                Lampa.Storage.set(key, value);
                return;
            }
        } catch (e) {}

        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {}
    }

    // ─── Settings ──────────────────────────────────────────────────────

    /**
     * Получить объединённые настройки (значения по умолчанию + пользовательские).
     *
     * Настройки хранятся в Lampa.Storage под ключом 'shikimori_settings_v2'.
     * При первом запуске используются defaults(). При последующих — merged с сохранёнными.
     *
     * @returns {Object} Объект настроек с полями:
     *   @property {string} title_language - Язык названий ('original'|'en'|'ru')
     *   @property {boolean} hide_adult - Скрывать 18+ контент
     *   @property {string} default_sort - Сортировка по умолчанию ('popularity'|'ranked'|'aired_on'|'name')
     *   @property {string} card_size - Размер карточек ('normal'|'compact')
     *   @property {string} shiki_host - Домен Shikimori API
     *
     * @example
     * var s = readSettings();
     * if (s.hide_adult) { /* фильтрация 18+ *\/ }
     */
    function readSettings() {
        var base = defaults();
        var saved = storageGet(SETTINGS_KEY, {});
        var key;

        if (!saved || typeof saved !== 'object') saved = {};

        for (key in saved) {
            if (saved.hasOwnProperty(key)) base[key] = saved[key];
        }

        return base;
    }

    function saveSettings(settings) {
        storageSet(SETTINGS_KEY, settings || defaults());
    }

    /**
     * Получить настроенный домен Shikimori (по умолчанию: https://shikimori.io).
     * @returns {string} URL домена без завершающего слэша
     */
    function getShikiHost() {
        var settings = readSettings();
        return (settings.shiki_host || 'https://shikimori.io').replace(/\/$/, '');
    }

    // ─── Auth ──────────────────────────────────────────────────────────

    /**
     * Получить состояние авторизации по умолчанию (пустое).
     *
     * @returns {Object} Объект авторизации:
     *   @property {number} id - ID пользователя Shikimori
     *   @property {string} client_id - OAuth Client ID
     *   @property {string} client_secret - OAuth Client Secret
     *   @property {string} redirect_uri - URI для перенаправления (по умолчанию 'urn:ietf:wg:oauth:2.0:oob')
     *   @property {string} access_token - Токен доступа
     *   @property {string} refresh_token - Токен обновления
     *   @property {number} expires_at - Unix timestamp истечения токена (мс)
     *   @property {string} nickname - Никнейм пользователя
     */
    function defaultAuth() {
        return {
            id: 0,
            client_id: '',
            client_secret: '',
            redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
            access_token: '',
            refresh_token: '',
            expires_at: 0,
            nickname: ''
        };
    }

    /** Чтение состояния авторизации из хранилища. */
    function readAuth() {
        var base = defaultAuth();
        var saved = storageGet(AUTH_KEY, {});
        var key;

        if (!saved || typeof saved !== 'object') saved = {};

        for (key in saved) {
            if (saved.hasOwnProperty(key)) base[key] = saved[key];
        }

        return base;
    }

    /** Сохранение состояния авторизации в хранилище. */
    function saveAuth(auth) {
        storageSet(AUTH_KEY, auth || defaultAuth());
    }

    /** Проверка: токен доступа действителен (не истёк). */
    function isAuthorized() {
        var auth = readAuth();
        return !!(auth.access_token && auth.expires_at && auth.expires_at > Date.now() + 60000);
    }

    /** Текст статуса авторизации для UI настроек. */
    function authStatusTitle() {
        var auth = readAuth();

        if (isAuthorized()) return 'подключено' + (auth.nickname ? ': ' + auth.nickname : '');
        if (auth.refresh_token) return 'требуется обновление';
        if (auth.client_id && auth.client_secret) return 'ключи введены';

        return 'не подключено';
    }

    // ─── Utilities ─────────────────────────────────────────────────────

    /** Показать уведомление через Lampa.Noty или console.log. */
    function notify(message) {
        if (window.Lampa && Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(message);
        else if (window.console) console.log(message);
    }

    /** Экранирование HTML-сущностей в строке. */
    function esc(value) {
        value = value === undefined || value === null ? '' : String(value);

        return value.replace(/[&<>"']/g, function (symbol) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
                '\\': '&#92;'
            }[symbol];
        });
    }

    /** Преобразование кода сезона Shikimori (напр. "winter_2024") в отображаемое название. */
    function seasonName(code) {
        var map = {
            winter: 'зима',
            spring: 'весна',
            summer: 'лето',
            fall: 'осень'
        };

        var parts;

        if (!code) return '';

        parts = String(code).split('_');

        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return parts[0] + '-' + parts[1];
        if (parts.length === 1 && !isNaN(parts[0])) return parts[0] + ' год';

        return (map[parts[0]] || parts[0] || '') + (parts[1] ? ' ' + parts[1] : '');
    }

    /** Маппинг slug типа аниме Shikimori в отображаемое название. */
    function kindName(kind) {
        var map = {
            tv: 'TV',
            movie: 'Movie',
            ova: 'OVA',
            ona: 'ONA',
            special: 'Special',
            tv_special: 'TV Special',
            music: 'Music',
            pv: 'PV',
            cm: 'CM'
        };

        return map[kind] || (kind ? String(kind).toUpperCase() : 'Anime');
    }

    /** Маппинг slug статуса Shikimori в русское название. */
    function statusName(status) {
        var map = {
            anons: 'анонс',
            ongoing: 'онгоинг',
            released: 'вышло'
        };

        return map[status] || status || '';
    }

    /** Маппинг ключа сортировки Shikimori в русское название. */
    function sortName(sort) {
        var map = {
            popularity: 'популярность',
            ranked: 'рейтинг',
            name: 'название',
            aired_on: 'дата выхода'
        };

        return map[sort] || sort || '';
    }

    // ─── Titles ────────────────────────────────────────────────────────

    /**
     * Получить отображаемое название на основе настройки языка.
     * @param {Object} data - Данные аниме с полями name, english, russian
     * @returns {string} Строка названия
     */
    function titleOf(data) {
        var settings = readSettings();

        if (settings.title_language === 'original') return data.name || data.english || data.russian || 'Shikimori';
        if (settings.title_language === 'en') return data.english || data.name || data.russian || 'Shikimori';

        return data.russian || data.name || data.english || 'Shikimori';
    }

    /** Получить вторичное (оригинальное) название на основе настройки языка. */
    function originalTitleOf(data) {
        var settings = readSettings();

        if (settings.title_language === 'original') return data.russian || data.english || '';
        if (settings.title_language === 'en') return data.name || data.russian || '';

        return data.name || data.english || '';
    }

    // ─── Poster System ─────────────────────────────────────────────────

    /**
     * Нормализация URL постера: обработка protocol-relative, старых доменов, относительных путей.
     *
     * Обрабатывает:
     * - Protocol-relative URLs (//example.com/img.jpg → https://example.com/img.jpg)
     * - Старые домены Shikimori (shikimori.one, shikimori.me, shikimori.club → shikimori.io)
     * - Относительные пути (/posters/1.jpg → https://shikimori.io/posters/1.jpg)
     *
     * @param {string} url - Исходный URL постера из API Shikimori
     * @returns {string} Нормализованный абсолютный URL или пустая строка
     *
     * @example
     * normalizePosterUrl('//example.com/img.jpg')     // 'https://example.com/img.jpg'
     * normalizePosterUrl('/posters/1.jpg')             // 'https://shikimori.io/posters/1.jpg'
     * normalizePosterUrl('https://shikimori.one/1.jpg') // 'https://shikimori.io/1.jpg'
     */
    function normalizePosterUrl(url) {
        url = url === undefined || url === null ? '' : String(url).trim();

        if (!url) return '';
        if (/^\/\//.test(url)) return 'https:' + url;
        
        if (/^https?:\/\//.test(url)) {
            return url.replace('shikimori.one', 'shikimori.io').replace('shikimori.me', 'shikimori.io').replace('shikimori.club', 'shikimori.io');
        }

        return getShikiHost() + (url.indexOf('/') === 0 ? url : '/' + url);
    }

    /**
     * Проверка: URL постера — заглушка/отсутствующее изображение.
     * @param {string} url - URL постера для проверки
     * @returns {boolean} True если URL указывает на заглушку
     */
    function isBadPosterUrl(url) {
        url = String(url || '').toLowerCase();

        return !url ||
            url.indexOf('missing_original') !== -1 ||
            url.indexOf('missing_preview') !== -1 ||
            url.indexOf('missing_main') !== -1 ||
            url.indexOf('/assets/globals/missing') !== -1 ||
            url.indexOf('/images/missing') !== -1;
    }

    /** Добавить URL постера в список, если он валиден и не дубликат. */
    function pushPosterUrl(list, value) {
        var url = normalizePosterUrl(value);

        if (!url || isBadPosterUrl(url)) return;
        if (list.indexOf(url) === -1) list.push(url);
    }

    /**
     * Извлечь все валидные URL постеров из данных аниме (ответ API Shikimori).
     *
     * Поддерживает оба формата ответа API Shikimori:
     * - Старый формат: { poster: { original_url, preview_url, ... } }
     * - Новый формат: { poster: { originalUrl, previewUrl, ... }, image: { original, preview, ... } }
     *
     * Приоритет URL:
     * 1. poster.mainUrl/main_url (наибольший)
     * 2. poster.previewUrl/preview_url
     * 3. image.preview
     * 4. poster.originalUrl/original_url
     * 5. image.original
     * 6. poster.x96Url/x96_url/image.x96
     * 7. poster.x48Url/x48_url/image.x48 (наименьший)
     *
     * Фильтрует заглушки (missing_original, missing_preview, и т.д.).
     *
     * @param {Object} data - Маппинг данных аниме с полями poster и image
     * @returns {string[]} Массив валидных URL постеров (без дубликатов)
     *
     * @see {@link normalizePosterUrl} для нормализации URL
     * @see {@link isBadPosterUrl} для фильтрации заглушек
     */
    function posterUrls(data) {
        var list = [];
        var poster = data && data.poster ? data.poster : {};
        var image = data && data.image ? data.image : {};

        pushPosterUrl(list, poster.mainUrl || poster.main_url);
        pushPosterUrl(list, poster.previewUrl || poster.preview_url);
        pushPosterUrl(list, image.preview);
        pushPosterUrl(list, poster.originalUrl || poster.original_url);
        pushPosterUrl(list, image.original);
        pushPosterUrl(list, poster.x96Url || poster.x96_url || image.x96);
        pushPosterUrl(list, poster.x48Url || poster.x48_url || image.x48);

        return list;
    }

    /**
     * Получить лучший URL постера: первый валидный Shikimori URL или fallback из кеша TMDB.
     *
     * Цепочка приоритетов:
     * 1. Локальные URL постеров из Shikimori API (posterUrls)
     * 2. Кеш TMDB (если previously resolved через resolveExternalPoster)
     * 3. Пустая строка (показать заглушку)
     *
     * @param {Object} data - Маппинг данных аниме с id, poster, image
     * @returns {string} Лучший доступный URL постера или пустая строка
     *
     * @example
     * var poster = posterOf(animeData);
     * if (poster) img.src = poster;
     */
    function posterOf(data) {
        var list = posterUrls(data);
        if (list.length) return list[0];

        var tmdbCache = storageGet(TMDB_CACHE_KEY, {});

        if (tmdbCache[data.id] && tmdbCache[data.id].poster) {
            return tmdbCache[data.id].poster;
        }

        return '';
    }

    /**
     * Построить URL изображения TMDB. Использует Lampa.TMDB.image() для прокси.
     * @param {string} path - Путь постера TMDB (напр. "/abc123.jpg") или полный URL
     * @returns {string} Полный URL изображения
     */
    function tmdbPosterUrl(path) {
        path = path === undefined || path === null ? '' : String(path).trim();

        if (!path) return '';
        if (/^https?:\/\//.test(path)) return path;

        var sub = 't/p/w342' + (path.indexOf('/') === 0 ? path : '/' + path);

        if (window.Lampa && Lampa.TMDB && typeof Lampa.TMDB.image === 'function') {
            return Lampa.TMDB.image(sub);
        }

        return 'https://image.tmdb.org/' + sub;
    }

    /** Получить текущий язык Lampa (по умолчанию: 'ru'). */
    function tmdbLanguage() {
        try {
            return window.Lampa && Lampa.Storage ? Lampa.Storage.get('language', 'ru') : 'ru';
        } catch (e) {
            return 'ru';
        }
    }

    /**
     * Универсальный хелпер для JSON-запросов. Использует Lampa.Reguest или $.ajax.
     * @param {string} url - URL API
     * @param {Function} success - Колбэк с распарсенным JSON
     * @param {Function} [error] - Колбэк ошибки (опционально)
     */
    function apiGetJson(url, success, error) {
        if (window.Lampa && typeof Lampa.Reguest === 'function') {
            try {
                var network = new Lampa.Reguest();
                if (typeof network.timeout === 'function') network.timeout(8000);
                if (typeof network.silent === 'function') {
                    network.silent(url, success, error || function () {});
                    return;
                }
            } catch (e) {}
        }

        if (window.$) {
            $.ajax({
                url: url,
                dataType: 'json',
                timeout: 8000,
                success: success,
                error: error || function () {}
            });
        } else {
            console.error('Shikimori: no network method available');
        }
    }

    /**
     * JSON-запрос с Authorization заголовком.
     * @param {string} method - HTTP метод (GET, POST, PATCH, DELETE)
     * @param {string} url - URL API
     * @param {Object|null} body - Тело запроса (для POST/PATCH) или null
     * @param {string} token - Access token
     * @param {Function} success - Колбэк с распарсенным JSON
     * @param {Function} [error] - Колбэк ошибки
     */
    function apiRequestAuth(method, url, body, token, success, error) {
        var headers = token ? { Authorization: 'Bearer ' + token } : {};

        $.ajax({
            url: url,
            method: method,
            contentType: body ? 'application/json' : undefined,
            dataType: 'json',
            timeout: 12000,
            headers: headers,
            data: body ? JSON.stringify(body) : undefined,
            success: success,
            error: error || function () {}
        });
    }

    /**
     * Построить умные поисковые запросы из названия аниме.
     * Удаляет информацию о сезонах, текст в скобках, завершающие числа.
     * @param {string} value - Исходная строка названия
     * @param {string[]} queriesArray - Массив для добавления сгенерированных запросов
     */
    function buildSmartQueries(value, queriesArray) {
        if (!value) return;
        var str = String(value);
        
        var cleaned = str
            .replace(/\b(Season|Part|Cour)\s*\d*\.?\d*\b/gi, '')
            .replace(/\b(\d+(st|nd|rd|th)? Season)\b/gi, '')
            .replace(/\b(Сезон|Часть|Кур)\s*\d*\.?\d*\b/gi, '')
            .replace(/\b(\d+(-й|-я|-ое|-е)? Сезон)\b/gi, '')
            .replace(/[\(\[\{].*?[\)\]\}]/g, '')
            .replace(/[^\wа-яёА-ЯЁ\s:\-]/gi, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();

        if (cleaned && queriesArray.indexOf(cleaned) === -1) queriesArray.push(cleaned);

        var splitPos = cleaned.search(/[:\-]/);
        var shortCleaned = '';
        if (splitPos > 0) {
            shortCleaned = cleaned.substring(0, splitPos).trim();
            if (shortCleaned && shortCleaned.length > 1 && queriesArray.indexOf(shortCleaned) === -1) {
                queriesArray.push(shortCleaned);
            }
        }

        var stripRegex = /\s+(1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th|II|III|IV|V|VI|VII|VIII|IX|X)$/i;
        
        var noDigitFull = cleaned.replace(stripRegex, '').trim();
        if (noDigitFull && noDigitFull !== cleaned && noDigitFull.length > 1 && queriesArray.indexOf(noDigitFull) === -1) {
            queriesArray.push(noDigitFull);
        }

        if (shortCleaned) {
            var noDigitShort = shortCleaned.replace(stripRegex, '').trim();
            if (noDigitShort && noDigitShort !== shortCleaned && noDigitShort.length > 1 && queriesArray.indexOf(noDigitShort) === -1) {
                queriesArray.push(noDigitShort);
            }
        }
    }

    /**
     * Извлечь год из данных аниме (поддерживает маппинг и raw API).
     * @param {Object} data - Данные аниме с airedOn.year или aired_on
     * @returns {number} Год или 0 если не найден
     */
    function getAnimeYear(data) {
        if (!data) return 0;
        if (data.airedOn && data.airedOn.year) return parseInt(data.airedOn.year, 10);
        if (data.aired_on) return parseInt(String(data.aired_on).substring(0, 4), 10);
        return 0;
    }

    /** Проверка: элемент TMDB совпадает с целевым годом (с допуском для сезонов TV). */
    function tmdbYearMatch(item, year) {
        if (!year) return true;
        var itemYear = item.first_air_date
            ? parseInt(item.first_air_date.substring(0, 4), 10)
            : (item.release_date ? parseInt(item.release_date.substring(0, 4), 10) : 0);
        if (!itemYear) return true;
        if (item.media_type === 'tv') {
            return year >= itemYear - 2 && year <= itemYear + 20;
        }
        return Math.abs(itemYear - year) <= 2;
    }

    /**
     * Построить URL API TMDB. Использует Lampa.TMDB.api() для прокси.
     * @param {string} path - Путь API (напр. "search/multi?query=Naruto")
     * @returns {string} Полный URL API
     */
    function tmdbApiUrl(path) {
        if (window.Lampa && Lampa.TMDB && typeof Lampa.TMDB.api === 'function') {
            return Lampa.TMDB.api(path);
        }

        return 'https://api.themoviedb.org/3/' + path;
    }

    /**
     * Последовательный поиск TMDB multi с запросами, матчем по годам и фильтрацией.
     *
     * Пробует каждый запрос по очереди直到找到 совпадение.
     * Для каждого результата проверяет: media_type (tv/movie), filterFn, tmdbYearMatch.
     *
     * @param {string[]} queries - Поисковые запросы по порядку приоритета
     * @param {number} year - Целевой год для матча (0 — пропустить проверку года)
     * @param {Function} filterFn - Функция фильтрации результатов TMDB (принимает item, возвращает boolean)
     * @param {Function} onMatch - Вызывается с первым совпавшим элементом TMDB
     * @param {Function} onDone - Вызывается когда все запросы исчерпаны без совпадения
     *
     * @example
     * searchTmdbMulti(['Naruto', 'Naruto Shippuden'], 2002,
     *     function(item) { return !!item.poster_path; },
     *     function(best) { console.log('Found:', best.name); },
     *     function() { console.log('Not found'); }
     * );
     */
    function searchTmdbMulti(queries, year, desiredType, onMatch, onDone) {
        var index = 0;
        var bestMatch = null;
        var anyMatch = null;

        function finish() {
            if (bestMatch) { onMatch(bestMatch); return; }
            if (anyMatch) { onMatch(anyMatch); return; }
            onDone();
        }

        function next() {
            if (index >= queries.length) { finish(); return; }
            var query = queries[index++];
            var url = tmdbApiUrl('search/multi?api_key=' + TMDB_API_KEY +
                '&language=' + encodeURIComponent(tmdbLanguage()) +
                '&query=' + encodeURIComponent(query));
            apiGetJson(url, function (res) {
                var results = res && res.results ? res.results : [];
                for (var i = 0; i < results.length; i++) {
                    var item = results[i];
                    if ((item.media_type === 'tv' || item.media_type === 'movie') && item.poster_path && tmdbYearMatch(item, year)) {
                        if (!bestMatch && desiredType && item.media_type === desiredType) {
                            bestMatch = item;
                            finish();
                            return;
                        }
                        if (!anyMatch) anyMatch = item;
                    }
                }
                next();
            }, next);
        }
        next();
    }

    /** Кешировать разрешённый URL постера для ID аниме. */
    function saveResolvedPoster(animeId, posterUrl) {
        var cache = storageGet(POSTER_CACHE_KEY, {});
        cache[animeId] = posterUrl || '';
        storageSet(POSTER_CACHE_KEY, cache);
    }

    /** Завершить ожидающий запрос постера: сохранить в кеш и вызвать все ожидающие колбэки. */
    function finishPosterRequest(animeId, posterUrl) {
        var callbacks = posterRequests[animeId] || [];
        delete posterRequests[animeId];

        saveResolvedPoster(animeId, posterUrl);

        for (var i = 0; i < callbacks.length; i++) {
            callbacks[i](posterUrl || '');
        }
    }

    /**
     * Получить постер через TMDB details endpoint через прокси.
     * @param {Object} data - Данные аниме (для кеша по data.id)
     * @param {number|string} tmdbId - ID TMDB
     * @param {string} type - 'tv' или 'movie'
     * @param {Function} callback - Вызывается с URL постера или пустой строкой
     */
    function fetchTmdbDetailsPoster(data, tmdbId, type, callback) {
        type = type === 'movie' ? 'movie' : 'tv';

        var url = tmdbApiUrl(type +
            '/' + encodeURIComponent(tmdbId) +
            '?api_key=' + TMDB_API_KEY +
            '&language=' + encodeURIComponent(tmdbLanguage()));

        apiGetJson(url, function (res) {
            var poster = tmdbPosterUrl(res && res.poster_path ? res.poster_path : '');

            if (poster) {
                var tmdbCache = storageGet(TMDB_CACHE_KEY, {});
                tmdbCache[data.id] = {
                    id: tmdbId,
                    type: type,
                    poster: poster
                };
                storageSet(TMDB_CACHE_KEY, tmdbCache);
            }

            callback(poster);
        }, function () {
            callback('');
        });
    }

    /**
     * Разрешить постер через поиск TMDB multi.
     * @param {Object} data - Данные аниме с полями english/name/russian
     * @param {Function} callback - Вызывается с URL постера или пустой строкой
     */
    function resolvePosterByTmdbSearch(data, callback) {
        var queries = [];
        var year = getAnimeYear(data);

        buildSmartQueries(data.english, queries);
        buildSmartQueries(data.name, queries);
        buildSmartQueries(data.russian, queries);

        if (!queries.length) { callback(''); return; }

        searchTmdbMulti(queries, year, null,
            function (best) {
                var poster = tmdbPosterUrl(best.poster_path);
                var tmdbCache = storageGet(TMDB_CACHE_KEY, {});
                tmdbCache[data.id] = { id: best.id, type: best.media_type === 'movie' ? 'movie' : 'tv', poster: poster };
                storageSet(TMDB_CACHE_KEY, tmdbCache);
                callback(poster);
            },
            function () { callback(''); }
        );
    }

    /** Построить URL ARM API для поиска MAL→TMDB ID. */
    function armLookupUrl(malId) {
        return ARM_HOST + '/api/v2/ids?source=myanimelist&id=' +
            encodeURIComponent(malId) +
            '&include=themoviedb,myanimelist';
    }

    /**
     * Разрешить постер из внешних источников (TMDB прокси).
     *
     * Цепочка разрешения (с кешированием и deduplication параллельных запросов):
     * 1. Кеш постеров (POSTER_CACHE_KEY) — мгновенный ответ
     * 2. Кеш TMDB (TMDB_CACHE_KEY) — если ранее был найден TMDB ID
     * 3. ARM lookup (arm.haglund.dev) — маппинг MAL→TMDB ID
     * 4. TMDB details (poster_path) — прямой запрос по TMDB ID
     * 5. TMDB search (multi) — поиск по названию с умными запросами
     *
     * Параллельные запросы для одного animeId объединяются в очередь posterRequests.
     *
     * @param {Object} data - Маппинг данных аниме (обязательно: data.id)
     * @param {Function} callback - Вызывается с URL постера или пустой строкой
     *
     * @see {@link posterOf} для получения лучшего URL
     * @see {@link installPosterFallback} для установки fallback на элемент img
     */
    function resolveExternalPoster(data, callback) {
        if (!data || !data.id) {
            callback('');
            return;
        }

        var posterCache = storageGet(POSTER_CACHE_KEY, {});

        if (posterCache.hasOwnProperty(data.id)) {
            callback(posterCache[data.id] || '');
            return;
        }

        if (posterRequests[data.id]) {
            posterRequests[data.id].push(callback);
            return;
        }

        posterRequests[data.id] = [callback];

        var tmdbCache = storageGet(TMDB_CACHE_KEY, {});

        if (tmdbCache[data.id] && tmdbCache[data.id].poster) {
            finishPosterRequest(data.id, tmdbCache[data.id].poster);
            return;
        }

        if (tmdbCache[data.id] && tmdbCache[data.id].id) {
            fetchTmdbDetailsPoster(data, tmdbCache[data.id].id, tmdbCache[data.id].type, function (poster) {
                if (poster) {
                    finishPosterRequest(data.id, poster);
                } else {
                    resolvePosterByTmdbSearch(data, function (searchPoster) {
                        if (searchPoster) {
                            finishPosterRequest(data.id, searchPoster);
                        } else {
                            finishPosterRequest(data.id, '');
                        }
                    });
                }
            });
            return;
        }

        var armUrl = armLookupUrl(data.id);

        apiGetJson(armUrl, function (answer) {
            var tmdbId = answer && (answer.themoviedb || answer.tmdb_id || answer.id);
            var type = answer && (answer.media_type || answer.type);

            if (!type) type = data.kind === 'movie' ? 'movie' : 'tv';

            if (tmdbId) {
                fetchTmdbDetailsPoster(data, tmdbId, type, function (poster) {
                    if (poster) {
                        finishPosterRequest(data.id, poster);
                    } else {
                        resolvePosterByTmdbSearch(data, function (searchPoster) {
                            finishPosterRequest(data.id, searchPoster);
                        });
                    }
                });
            } else {
                resolvePosterByTmdbSearch(data, function (searchPoster) {
                    finishPosterRequest(data.id, searchPoster);
                });
            }
        }, function () {
            resolvePosterByTmdbSearch(data, function (searchPoster) {
                finishPosterRequest(data.id, searchPoster);
            });
        });
    }

    /**
     * Установить логику fallback постера на элемент <img>.
     *
     * Пробует каждый URL по порядку (из posterUrls), при ошибке загрузки
     * переходит к следующему. Если все локальные URL исчерпаны —
     * разрешает внешний постер через TMDB прокси (resolveExternalPoster).
     *
     * Использует jQuery data для отслеживания состояния:
     * - poster-index: текущий индекс в массиве urls
     * - poster-external-tried: был ли предпринят вызов TMDB
     * - poster-fallback-done: показана ли заглушка
     *
     * @param {HTMLElement|jQuery} img - Элемент изображения
     * @param {string[]} urls - Локальные URL постеров для попыток (по приоритету)
     * @param {string} fallback - SVG/data-URI заглушка если все URL не сработали
     * @param {Object} data - Данные аниме для внешнего разрешения (обязательно: data.id)
     *
     * @example
     * installPosterFallback(
     *     $('img.card__img'),
     *     posterUrls(animeData),
     *     noPosterSVG,
     *     animeData
     * );
     */
    function installPosterFallback(img, urls, fallback, data) {
        img = $(img);
        urls = urls || [];

        img.data('poster-index', 0);
        img.data('poster-external-tried', false);
        img.data('poster-fallback-done', false);

        function setFallback() {
            if (img.data('poster-fallback-done')) return;

            img.data('poster-fallback-done', true);
            img.attr('src', fallback);
        }

        function tryExternalPoster() {
            if (img.data('poster-external-tried')) {
                setFallback();
                return;
            }

            img.data('poster-external-tried', true);

            resolveExternalPoster(data, function (url) {
                if (url) img.attr('src', url);
                else setFallback();
            });
        }

        img.on('error', function () {
            var index;

            if (img.data('poster-fallback-done')) return;

            index = parseInt(img.data('poster-index'), 10) || 0;
            index += 1;

            img.data('poster-index', index);

            if (urls[index]) {
                img.attr('src', urls[index]);
            } else {
                tryExternalPoster();
            }
        });

        if (!urls.length) tryExternalPoster();
    }

    // ─── Genres & API ──────────────────────────────────────────────────

    /**
     * Загрузить жанры из Shikimori GraphQL API (с локальным кешем на 24ч).
     *
     * @param {Function} callback - Вызывается с отфильтрованным списком жанров
     */
    function loadGenres(callback) {
        var cache = storageGet(GENRES_CACHE_KEY, null);
        var DAY_MS = 86400000;

        if (cache && cache.genres && cache.genres.length && cache.ts && (Date.now() - cache.ts) < DAY_MS) {
            callback(filterGenres(cache.genres));
            return;
        }

        gqlQuery('{ genres(entryType: Anime) { id name russian } }', function (data) {
            if (!data || !data.genres || !data.genres.length) {
                callback([]);
                return;
            }

            storageSet(GENRES_CACHE_KEY, { genres: data.genres, ts: Date.now() });
            callback(filterGenres(data.genres));
        }, function () {
            callback([]);
        });
    }

    /**
     * Запрос списка аниме из Shikimori GraphQL API.
     *
     * Использует GraphQL вместо REST для получения полных URL постеров.
     *
     * @param {Object} params - Параметры запроса
     * @param {Function} oncomplete - Вызывается с массивом маппинга аниме
     * @param {Function} [onerror] - Колбэк ошибки (опционально)
     */
    function requestAnime(params, oncomplete, onerror) {
        var page = parseInt(params.page, 10) || 1;
        var sort = params.sort || readSettings().default_sort;

        var args = [];
        args.push('limit: ' + PAGE_LIMIT);
        args.push('page: ' + page);

        var orderMap = { popularity: 'popularity', ranked: 'ranked', aired_on: 'aired_on', name: 'name' };
        if (orderMap[sort]) args.push('order: ' + orderMap[sort]);

        if (params.search) args.push('search: "' + params.search.replace(/"/g, '\\"') + '"');
        if (params.kind) args.push('kind: "' + params.kind + '"');
        if (params.status) args.push('status: "' + params.status + '"');
        if (params.season) args.push('season: "' + params.season + '"');
        if (params.genre) args.push('genre: "' + params.genre + '"');

        var query = '{ animes(' + args.join(', ') + ') { ' +
            'id name russian english kind status score ' +
            'episodes episodesAired season ' +
            'poster { mainUrl main2xUrl previewUrl miniUrl originalUrl } ' +
            'genres { id name russian } ' +
            '} }';

        gqlQuery(query, function (data) {
            if (!data || !data.animes) {
                oncomplete([]);
                return;
            }

            var mapped = [];

            for (var i = 0; i < data.animes.length; i++) {
                var mappedItem = mapShikiAnime(data.animes[i]);
                if (mappedItem) mapped.push(mappedItem);
            }

            oncomplete(mapped);
        }, function () {
            notify('Shikimori: не удалось загрузить каталог');
            if (onerror) onerror();
        });
    }

    // ─── Navigation ────────────────────────────────────────────────────

    /**
     * Открыть полную страницу аниме. Пробует кеш TMDB → ARM lookup → fallback поиск.
     *
     * Цепочка навигации:
     * 1. Кеш TMDB (TMDB_CACHE_KEY) — если ранее был найден TMDB ID для этого animeId
     * 2. ARM lookup (arm.haglund.dev/api/v2/themoviedb) — reverse lookup по TMDB ID
     * 3. Fallback поиск (searchTmdbMulti) — поиск по названию
     * 4. Lampa Search — если TMDB не найден
     *
     * Открывает Lampa.Activity с component='full' и source='tmdb'.
     *
     * @param {Object} data - Маппинг данных аниме Shikimori (обязательно: data.id, data.name)
     *
     * @see {@link openTmdb} для открытия TMDB страницы
     * @see {@link fallbackSearch} для fallback поиска
     * @see {@link openLampaSearch} для ручного поиска Lampa
     */
    function openAnime(data) {
        var tmdbCache = storageGet(TMDB_CACHE_KEY, {});

        if (tmdbCache[data.id] && tmdbCache[data.id].id) {
            openTmdb({
                id: tmdbCache[data.id].id,
                media_type: tmdbCache[data.id].type
            }, data);
            return;
        }

        var url = armLookupUrl(data.id);

        var onSuccess = function (answer) {
            if (answer && answer.themoviedb) {
                var armType = answer.media_type || answer.type || '';
                var expectedType = data.kind === 'movie' ? 'movie' : 'tv';

                if (armType && armType !== expectedType) {
                    fallbackSearch(data);
                    return;
                }

                openTmdb(answer, data);
            } else {
                fallbackSearch(data);
            }
        };

        apiGetJson(url, onSuccess, function () {
            fallbackSearch(data);
        });
    }

    /** Поиск TMDB по названию при ошибке ARM lookup. Открывает полную страницу TMDB или поиск Lampa. */
    function fallbackSearch(data) {
        var queries = [];

        buildSmartQueries(data.english, queries);
        buildSmartQueries(data.name, queries);
        buildSmartQueries(data.russian, queries);

        if (queries.length === 0) { openLampaSearch(data); return; }

        var shikiYear = getAnimeYear(data);
        var desiredType = data.kind === 'movie' ? 'movie' : 'tv';

        notify('Поиск в базе...');
        searchTmdbMulti(queries, shikiYear, desiredType,
            function (best) { openTmdb(best, data); },
            function () { openLampaSearch(data); }
        );
    }

    /** Открыть встроенный поиск Lampa с названием аниме в качестве запроса. */
    function openLampaSearch(shiki) {
        notify('Shikimori: Не найдено в TMDB, открыт ручной поиск');

        var query = titleOf(shiki);

        if (window.Lampa && Lampa.Activity) {
            Lampa.Activity.push({
                url: '',
                title: 'Поиск: ' + query,
                component: 'search',
                query: query
            });
        }
    }

    /**
     * Открыть полную страницу TMDB для аниме.
     * @param {Object} item - Элемент TMDB с id, media_type
     * @param {Object} shiki - Данные аниме Shikimori
     */
    function openTmdb(item, shiki) {
        var type = item.media_type || item.type || (shiki.kind === 'movie' ? 'movie' : 'tv');

        var mainTitle = titleOf(shiki) || item.title || item.name;
        var secTitle = originalTitleOf(shiki) || item.original_title || item.original_name || shiki.name;
        var shikiPoster = posterOf(shiki);

        var movie = {
            id: item.id || item.tmdb_id || item.themoviedb,
            title: mainTitle,
            original_title: secTitle,
            name: mainTitle,
            original_name: secTitle,
            poster_path: shikiPoster || item.poster_path || '',
            img: shikiPoster || '',
            backdrop_path: item.backdrop_path || '',
            vote_average: item.vote_average || 0,
            shikimori: shiki
        };

        if (!movie.id) {
            openLampaSearch(shiki);
            return;
        }

        var tmdbCache = storageGet(TMDB_CACHE_KEY, {});

        if (!tmdbCache[shiki.id] || tmdbCache[shiki.id].id !== movie.id) {
            tmdbCache[shiki.id] = {
                id: movie.id,
                type: type === 'movie' ? 'movie' : 'tv'
            };

            storageSet(TMDB_CACHE_KEY, tmdbCache);
        }

        if (window.Lampa && Lampa.Activity && typeof Lampa.Activity.push === 'function') {
            Lampa.Activity.push({
                url: '',
                title: movie.title,
                component: 'full',
                id: movie.id,
                method: type === 'movie' ? 'movie' : 'tv',
                card: movie,
                source: 'tmdb'
            });
        } else {
            openLampaSearch(shiki);
        }
    }

    // ─── OAuth ─────────────────────────────────────────────────────────

    /**
     * Построить URL авторизации OAuth для Shikimori.
     *
     * Формат: {shiki_host}/oauth/authorize?client_id=...&redirect_uri=...&response_type=code&scope=user_rates
     *
     * Scope 'user_rates' позволяет:
     * - Читать оценки пользователя (GET /api/v2/user_rates)
     * - Создавать/обновлять оценки (POST/PATCH /api/v2/user_rates)
     * - Удалять оценки (DELETE /api/v2/user_rates/:id)
     *
     * Redirect URI по умолчанию: 'urn:ietf:wg:oauth:2.0:oob' (out-of-band).
     * Пользователь видит код на экране и вводит его вручную.
     *
     * @returns {string} Полный URL авторизации или пустая строка если нет client_id
     *
     * @example
     * var url = authUrl();
     * if (url) showQrCode(url);
     */
    function authUrl() {
        var auth = readAuth();

        if (!auth.client_id || !auth.redirect_uri) return '';

        return getShikiHost() +
            '/oauth/authorize?client_id=' + encodeURIComponent(auth.client_id) +
            '&redirect_uri=' + encodeURIComponent(auth.redirect_uri) +
            '&response_type=code&scope=user_rates';
    }

    /**
     * Обмен кода авторизации на access + refresh токены.
     *
     * API: POST {shiki_host}/oauth/token
     * Content-Type: application/json
     * Body: { grant_type: 'authorization_code', client_id, client_secret, code, redirect_uri }
     *
     * Ответ: { access_token, refresh_token, expires_in, token_type, created_at }
     *
     * @param {string} code - Код авторизации полученный от Shikimori
     * @param {Function} [callback] - Вызывается после успешного сохранения токена
     *
     * @see {@link refreshToken} для обновления истёкшего токена
     * @see {@link saveTokenAnswer} для сохранения ответа
     */
    function requestTokenByCode(code, callback) {
        var auth = readAuth();

        if (!auth.client_id || !auth.client_secret || !auth.redirect_uri) {
            notify('Введите Client ID, Client Secret и Redirect URI');
            return;
        }

        $.ajax({
            url: getShikiHost() + '/oauth/token',
            method: 'POST',
            contentType: 'application/json',
            dataType: 'json',
            timeout: 15000,
            data: JSON.stringify({
                grant_type: 'authorization_code',
                client_id: auth.client_id,
                client_secret: auth.client_secret,
                code: code,
                redirect_uri: auth.redirect_uri
            }),
            success: function (answer) {
                saveTokenAnswer(answer);
                if (callback) callback();
            },
            error: function () {
                notify('Shikimori: не удалось получить токен');
            }
        });
    }

    /**
     * Обновить истёкший access token через refresh_token.
     *
     * API: POST {shiki_host}/oauth/token
     * Content-Type: application/json
     * Body: { grant_type: 'refresh_token', client_id, client_secret, refresh_token }
     *
     * При успехе — сохраняет новые токены через saveTokenAnswer().
     * При ошибке — показывает уведомление и вызывает callback(null).
     *
     * @param {Function} callback - Вызывается со status обновления:
     *   - undefined при успехе (токен сохранён)
     *   - null при ошибке (нет данных для обновления или запрос не удался)
     *
     * @see {@link requestTokenByCode} для первичного получения токена
     */
    function refreshToken(callback) {
        var auth = readAuth();

        if (!auth.client_id || !auth.client_secret || !auth.refresh_token) {
            notify('Shikimori: нет данных для обновления токена');
            return;
        }

        $.ajax({
            url: getShikiHost() + '/oauth/token',
            method: 'POST',
            contentType: 'application/json',
            dataType: 'json',
            timeout: 15000,
            data: JSON.stringify({
                grant_type: 'refresh_token',
                client_id: auth.client_id,
                client_secret: auth.client_secret,
                refresh_token: auth.refresh_token
            }),
            success: function (answer) {
                saveTokenAnswer(answer);
                if (callback) callback();
            },
            error: function () {
                notify('Shikimori: не удалось обновить токен');
                if (callback) callback(null);
            }
        });
    }

    /** Разобрать ответ токена и сохранить состояние авторизации. */
    function saveTokenAnswer(answer) {
        var auth = readAuth();
        var expires = (answer && answer.expires_in) ? parseInt(answer.expires_in, 10) || 86400 : 86400;

        auth.access_token = answer && answer.access_token ? answer.access_token : '';
        auth.refresh_token = answer && answer.refresh_token ? answer.refresh_token : auth.refresh_token;
        auth.expires_at = Date.now() + expires * 1000;

        saveAuth(auth);
        notify('Авторизация Shikimori сохранена');
    }

    /** Построить URL QR-кода для OAuth ссылки авторизации. */
    function qrCodeUrl(url) {
        return 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&margin=10&format=png&data=' + encodeURIComponent(url);
    }

    /**
     * Показать модальное окно с QR-кодом авторизации и полем ввода кода.
     * Пользователь сканирует QR-код телефоном, подтверждает доступ,
     * видит код на экране телефона и вводит его в Lampa.
     */
    function showAuthQrModal(btnElement) {
        var auth = readAuth();

        if (!auth.client_id) {
            notify('Сначала введите Client ID');
            return;
        }

        var url = authUrl();
        if (!url) {
            notify('Не удалось создать ссылку авторизации');
            return;
        }

        var qrSrc = qrCodeUrl(url);
        var overlay = $(
            '<div class="shikimori-qr-overlay">' +
                '<div class="shikimori-qr-modal">' +
                    '<div class="shikimori-qr-title">Авторизация Shikimori</div>' +
                    '<div class="shikimori-qr-hint">Отсканируйте QR-код телефоном</div>' +
                    '<div class="shikimori-qr-img-wrap">' +
                        '<img class="shikimori-qr-img" src="' + esc(qrSrc) + '" />' +
                    '</div>' +
                    '<div class="shikimori-qr-hint shikimori-qr-hint--small">После подтверждения нажмите «Ввести код»</div>' +
                    '<div class="shikimori-qr-buttons">' +
                        '<div class="simple-button selector shikimori-qr-btn shikimori-qr-btn--enter">Ввести код</div>' +
                        '<div class="simple-button selector shikimori-qr-btn shikimori-qr-btn--copy">Копировать ссылку</div>' +
                        '<div class="simple-button selector shikimori-qr-btn shikimori-qr-btn--close">Закрыть</div>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );

        $('body').append(overlay);

        var enterBtn = overlay.find('.shikimori-qr-btn--enter');
        var copyBtn = overlay.find('.shikimori-qr-btn--copy');
        var closeBtn = overlay.find('.shikimori-qr-btn--close');

        function restoreFocus() {
            if (btnElement) {
                try {
                    Lampa.Controller.collectionSet($('.Shikimori-module'));
                    Lampa.Controller.collectionFocus(btnElement, $('.Shikimori-module'));
                } catch (e) {}
            }
        }

        function closeModal() {
            overlay.remove();
            restoreFocus();
        }

        closeBtn.on('hover:enter click tap', closeModal);

        enterBtn.on('hover:enter click tap', function () {
            overlay.remove();

            if (window.Lampa && Lampa.Input && Lampa.Input.edit) {
                Lampa.Input.edit({
                    title: 'Код авторизации Shikimori',
                    value: '',
                    free: true
                }, function (code) {
                    code = String(code || '').trim();
                    if (!code) {
                        notify('Код не введён');
                        restoreFocus();
                        return;
                    }
                    notify('Отправка кода...');
                    requestTokenByCode(code, function () {
                        loadWhoami();
                        restoreFocus();
                    });
                });
            } else {
                var code = window.prompt('Код авторизации Shikimori', '');
                if (code !== null && String(code).trim()) {
                    requestTokenByCode(String(code).trim(), function () {
                        loadWhoami();
                    });
                }
                restoreFocus();
            }
        });

        copyBtn.on('hover:enter click tap', function () {
            if (window.Lampa && Lampa.Utils && Lampa.Utils.copyTextToClipboard) {
                Lampa.Utils.copyTextToClipboard(url, function () {
                    notify('Ссылка скопирована');
                });
            } else {
                notify(url);
            }
        });

        overlay.on('click', function (e) {
            if (e.target === overlay[0]) closeModal();
        });

        setTimeout(function () {
            Lampa.Controller.collectionSet(overlay);
            Lampa.Controller.collectionFocus(enterBtn, overlay);
        }, 100);
    }

    /**
     * Выполнить колбэк с действительным access token.
     *
     * Логика:
     * 1. Если токен действителен (не истёк + запас 60с) — callback(access_token)
     * 2. Если есть refresh_token — обновляет токен, затем callback(new_access_token)
     * 3. Если нет данных — показывает уведомление, callback(null)
     *
     * @param {Function} callback - Вызывается со строкой access_token или null
     *
     * @example
     * withAccessToken(function(token) {
     *     if (token) {
     *         apiRequestAuth('GET', url, null, token, onSuccess);
     *     }
     * });
     */
    function withAccessToken(callback) {
        var auth = readAuth();

        if (isAuthorized()) {
            callback(auth.access_token);
            return;
        }

        if (auth.refresh_token) {
            refreshToken(function () {
                callback(readAuth().access_token);
            });
            return;
        }

        notify('Shikimori: требуется авторизация');
        callback(null);
    }

    /** Загрузить профиль текущего пользователя из API Shikimori. */
    function loadWhoami() {
        withAccessToken(function (token) {
            apiRequestAuth('GET', getShikiHost() + '/api/users/whoami', null, token, function (user) {
                var auth = readAuth();

                auth.id = user && user.id ? user.id : 0;
                auth.nickname = user && user.nickname ? user.nickname : '';

                saveAuth(auth);

                notify(auth.nickname ? 'Shikimori: ' + auth.nickname : 'Shikimori: профиль получен');
            }, function () {
                notify('Shikimori: не удалось проверить профиль');
            });
        });
    }

    // ─── User Rates (Lists) ────────────────────────────────────────────

    /** Кеш оценок пользователя { animeId: rate }. */
    var userRatesCache = null;

    /** Очистить кеш оценок (вызывать после сохранения/удаления). */
    function clearUserRatesCache() {
        userRatesCache = null;
    }

    /**
     * Загрузить ВСЕ оценки пользователя за один запрос и сохранить в кеш.
     *
     * API: GET {shiki_host}/api/v2/user_rates?user_id={id}&target_type=Anime
     * Headers: Authorization: Bearer {token}
     *
     * Ответ: Array<{id, target_id, target_type, score, status, episodes, ...}>
     * Кешируется в userRatesCache как { [target_id]: rate }
     *
     * @param {Function} callback - Вызывается с объектом { [animeId]: rate }
     *
     * @see {@link getUserRateFromCache} для чтения из кеша
     * @see {@link clearUserRatesCache} для очистки кеша
     */
    function fetchAllUserRates(callback) {
        var auth = readAuth();

        if (!auth.id) {
            callback({});
            return;
        }

        withAccessToken(function (token) {
            var url = getShikiHost() + '/api/v2/user_rates?user_id=' + auth.id + '&target_type=Anime';

            apiRequestAuth('GET', url, null, token, function (res) {
                var map = {};
                if (Array.isArray(res)) {
                    for (var i = 0; i < res.length; i++) {
                        if (res[i] && res[i].target_id) map[res[i].target_id] = res[i];
                    }
                }
                userRatesCache = map;
                callback(map);
            }, function () {
                callback({});
            });
        });
    }

    /** Получить оценку для аниме из кеша (без запроса к API). */
    function getUserRateFromCache(animeId) {
        if (!userRatesCache) return null;
        return userRatesCache[animeId] || null;
    }

    /** Получить запись оценки пользователя для конкретного аниме. */
    function fetchUserRate(animeId, callback) {
        var auth = readAuth();

        if (!auth.id) {
            callback(null);
            return;
        }

        withAccessToken(function (token) {
            var url = getShikiHost() + '/api/v2/user_rates?user_id=' + auth.id + '&target_id=' + animeId + '&target_type=Anime';

            apiRequestAuth('GET', url, null, token, function (res) {
                callback(res && res.length ? res[0] : null);
            }, function () {
                callback(null);
            });
        });
    }

    /** Создать или обновить запись оценки пользователя (статус, оценка). */
    function saveUserRate(animeId, rateId, data, callback) {
        var auth = readAuth();

        withAccessToken(function (token) {
            var payload = {
                user_rate: {
                    target_id: animeId,
                    target_type: 'Anime',
                    user_id: auth.id
                }
            };

            for (var k in data) { if (data.hasOwnProperty(k)) payload.user_rate[k] = data[k]; }

            var method = rateId ? 'PATCH' : 'POST';
            var url = getShikiHost() + '/api/v2/user_rates' + (rateId ? '/' + rateId : '');

            apiRequestAuth(method, url, payload, token, function (res) {
                callback(res);
            }, function (xhr) {
                if (xhr.status === 403 || xhr.status === 401) {
                    notify('Ошибка прав! Выйдите из профиля и авторизуйтесь заново.');
                } else {
                    notify('Ошибка сохранения в список Shikimori');
                }
                callback(null);
            });
        });
    }

    /** Удалить запись оценки пользователя. */
    function deleteUserRate(rateId, callback) {
        withAccessToken(function (token) {
            apiRequestAuth('DELETE', getShikiHost() + '/api/v2/user_rates/' + rateId, null, token, function () {
                callback();
            }, function (xhr) {
                if (xhr.status === 403 || xhr.status === 401) {
                    notify('Ошибка прав! Выйдите из профиля и авторизуйтесь заново.');
                } else {
                    notify('Ошибка удаления из Shikimori');
                }
                callback(null);
            });
        });
    }

    /**
     * Инициализация кнопки списка Shikimori на полной странице.
     * Обрабатывает проверку авторизации, загрузку оценки, меню статуса/оценки/удаления.
     * @param {jQuery} btn - Элемент кнопки
     * @param {Object} anime - Данные аниме с id
     */
    function initShikimoriListButton(btn, anime) {
        var currentRate = null;
        var listLoading = false;
        var iconMode = btn.hasClass('shikimori-full-list-button');

        function setButtonState(text, active, loading) {
            if (iconMode) {
                btn.attr('title', 'Список Shikimori');
                btn.attr('aria-label', 'Список Shikimori');
                btn.attr('data-title', 'Список Shikimori');
                btn.attr('data-state-title', text || 'Список Shikimori');

                btn.find('.shikimori-full-list-button__text').text('Список Shikimori');

                btn.toggleClass('shikimori-list-active', !!active);
                btn.toggleClass('shikimori-list-loading', !!loading);
            } else {
                btn.text(text);
                btn.toggleClass('shikimori-list-active', !!active);
            }
        }

        function updateBtnLabel() {
            if (!isAuthorized()) {
                setButtonState('Список (Войти)', false, false);
                return;
            }

            var map = {
                planned: 'Запланировано',
                watching: 'Смотрю',
                rewatching: 'Пересматриваю',
                completed: 'Просмотрено',
                on_hold: 'Отложено',
                dropped: 'Брошено'
            };

            if (currentRate && currentRate.status) {
                var text = map[currentRate.status] || 'В списке';

                if (currentRate.score) text += ' (♥ ' + currentRate.score + ')';

                setButtonState(text, true, false);
            } else {
                setButtonState('Добавить в список', false, false);
            }
        }

        if (isAuthorized()) {
            var auth = readAuth();

            if (auth.id) {
                setButtonState('Загрузка списка...', false, true);

                fetchUserRate(anime.id, function (rate) {
                    currentRate = rate;
                    updateBtnLabel();
                });
            } else {
                updateBtnLabel();
            }
        } else {
            updateBtnLabel();
        }

        function runListAction() {
            if (listLoading) return;

            if (!isAuthorized()) {
                notify('Пожалуйста, авторизуйтесь в настройках Shikimori');
                return;
            }

            var auth = readAuth();

            if (!auth.id) {
                notify('Загрузка профиля, подождите...');
                loadWhoami();
                return;
            }

            showListMenu();
        }

        btn.data('action', runListAction);
        btn.off('.shikimori-list');

        btn.on('hover:enter.shikimori-list click.shikimori-list tap.shikimori-list mouseup.shikimori-list', function (e) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            runListAction();

            return false;
        });

        function showListMenu() {
            var map = [
                { title: 'Смотрю', value: 'watching' },
                { title: 'Запланировано', value: 'planned' },
                { title: 'Просмотрено', value: 'completed' },
                { title: 'Пересматриваю', value: 'rewatching' },
                { title: 'Отложено', value: 'on_hold' },
                { title: 'Брошено', value: 'dropped' }
            ];

            var items = [];

            for (var i = 0; i < map.length; i++) {
                var prefix = (currentRate && currentRate.status === map[i].value) ? '✓ ' : '';

                items.push({
                    title: prefix + map[i].title,
                    value: map[i].value,
                    action: 'status'
                });
            }

            items.push({
                title: 'Оценить (1-10)',
                action: 'rate'
            });

            if (currentRate && currentRate.id) {
                items.push({
                    title: 'Удалить из списка',
                    action: 'delete'
                });
            }

            Lampa.Select.show({
                title: 'Shikimori: Список',
                items: items,
                onSelect: function (item) {
                    if (item.action === 'status') {
                        setRateData({
                            status: item.value
                        });
                    } else if (item.action === 'rate') {
                        showRateMenu();
                    } else if (item.action === 'delete') {
                        removeRate();
                    }
                },
                onBack: function () {
                    Lampa.Controller.toggle('content');
                }
            });
        }

        function showRateMenu() {
            var items = [];

            for (var i = 10; i >= 1; i--) {
                var prefix = (currentRate && currentRate.score === i) ? '✓ ' : '';

                items.push({
                    title: prefix + i,
                    value: i
                });
            }

            items.push({
                title: 'Без оценки',
                value: 0
            });

            Lampa.Select.show({
                title: 'Оценка Shikimori',
                items: items,
                onSelect: function (item) {
                    setRateData({
                        score: item.value
                    });
                },
                onBack: function () {
                    showListMenu();
                }
            });
        }

        function setRateData(data) {
            listLoading = true;

            setButtonState('Сохранение...', !!(currentRate && currentRate.status), true);
            notify('Сохранение...');

            saveUserRate(anime.id, currentRate ? currentRate.id : null, data, function (newRate) {
                listLoading = false;
                currentRate = newRate;
                clearUserRatesCache();

                updateBtnLabel();

                notify('Успешно сохранено в Shikimori');
                Lampa.Controller.toggle('content');
            });
        }

        function removeRate() {
            if (!currentRate || !currentRate.id) return;

            listLoading = true;

            setButtonState('Удаление...', true, true);

            deleteUserRate(currentRate.id, function () {
                listLoading = false;
                currentRate = null;
                clearUserRatesCache();

                updateBtnLabel();

                notify('Удалено из списка Shikimori');
                Lampa.Controller.toggle('content');
            });
        }
    }

    // ─── Card & Catalog ────────────────────────────────────────────────

    /**
     * Конструктор карточки для одного аниме в каталоге.
     * Обрабатывает отображение постера, бейдж оценки, название и метаданные.
     * @param {Object} data - Маппинг данных аниме
     */
    function Card(data) {
        var settings = readSettings();
        var year = data && data.airedOn ? data.airedOn.year : '';
        var season = seasonName(data.season);
        var compact = settings.card_size === 'compact' ? ' Shikimori--compact' : '';
        var score = data.score && data.score !== '0.0' ? data.score : '—';
        var meta = [];

        var loadingSVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="440">' +
            '<rect width="100%" height="100%" fill="#22252d"/>' +
            '<text x="50%" y="50%" fill="#777" font-family="Arial" font-size="22" text-anchor="middle">Загрузка...</text>' +
            '</svg>'
        );

        var noPosterSVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="440">' +
            '<rect width="100%" height="100%" fill="#22252d"/>' +
            '<text x="50%" y="50%" fill="#777" font-family="Arial" font-size="22" text-anchor="middle">Нет постера</text>' +
            '</svg>'
        );

        var posterList = posterUrls(data);
        var imgSrc = posterList.length ? esc(posterList[0]) : noPosterSVG;

        if (season) meta.push(season);
        else if (year) meta.push(year);

        if (data.status) meta.push(statusName(data.status));

        this.data = data;

        this.render = function () {
            var element = $(
                '<div class="card Shikimori selector' + compact + '" data-id="' + esc(data.id) + '">' +
                    '<div class="card__view">' +
                        '<img class="card__img" src="' + imgSrc + '" />' +
                        '<div class="Shikimori-card__rating">★ ' + esc(score) + '</div>' +
                        '<div class="Shikimori-card__badge">' + esc(kindName(data.kind)) + '</div>' +
                        '<div class="Shikimori-card__user-rate" style="display:none"></div>' +
                    '</div>' +
                    '<div class="card__title">' + esc(titleOf(data)) + '</div>' +
                    '<div class="Shikimori-card__meta">' + esc(meta.join(' • ')) + '</div>' +
                '</div>'
            );

            installPosterFallback(element.find('.card__img'), posterList, noPosterSVG, data);

            if (isAuthorized()) {
                var rate = getUserRateFromCache(data.id);
                if (rate && rate.score) {
                    element.find('.Shikimori-card__user-rate').text('♥ ' + rate.score).show();
                }
            }

            return element;
        };
    }

    /**
     * Компонент каталога: прокручиваемая сетка карточек аниме с шапкой, фильтрами, пагинацией.
     * Регистрируется как Lampa компонент 'shikimori'.
     * @param {Object} object - Параметры активности (page, sort, search, kind, status, season, genre, mylist)
     */
    function Catalog(object) {
        var params = object || {};
        var scroll = new Lampa.Scroll({
            mask: true,
            over: true,
            step: 250
        });

        var html = $('<div class="Shikimori-module"></div>');
        var head = $('<div class="Shikimori-head"></div>');
        var quick = $('<div class="Shikimori-quick"></div>');
        var active = $('<div class="Shikimori-active"></div>');
        var body = $('<div class="Shikimori-body"></div>');

        var last;
        var lastCardId = null;
        var rendered = false;
        var loading = false;
        var ended = false;
        var autoLoading = false;

        params.page = parseInt(params.page, 10) || 1;

        if (!params.sort) params.sort = readSettings().default_sort;

        this.render = function () {
            if (!rendered) {
                rendered = true;

                html.append(head).append(quick).append(active).append(scroll.render());
                scroll.append(body);
                scroll.minus();

                scroll.onWheel = function (step) {
                    var enabledController = Lampa.Controller.enabled && Lampa.Controller.enabled();

                    if (enabledController && enabledController.name !== 'content') Lampa.Controller.toggle('content');

                    if (step > 0) Navigator.move('down');
                    else Navigator.move('up');
                };

                scroll.onEnd = function () {
                    loadNextPage(true);
                };

                buildHeader();
                load(false);
            }

            return html;
        };

        this.create = this.render;

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(html);

                    var focusTarget = null;

                    if (lastCardId) {
                        focusTarget = html.find('.selector[data-id="' + lastCardId + '"]')[0];
                    }

                    if (!focusTarget) focusTarget = last;

                    Lampa.Controller.collectionFocus(focusTarget || html.find('.selector').first(), html);
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () {
                    Navigator.move('right');
                },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () {
                    if (Navigator.canmove('down')) Navigator.move('down');
                },
                back: function () {
                    if (Lampa.Activity && Lampa.Activity.backward) Lampa.Activity.backward();
                },
                enter: function () {
                    var focused = html.find('.selector.focus');

                    if (focused.length) {
                        var action = focused.data('action');

                        if (action) action();
                    }
                }
            });

            Lampa.Controller.toggle('content');
        };

        this.stop = function () {};
        this.pause = function () {};

        this.destroy = function () {
            if (fullPollId) { clearInterval(fullPollId); fullPollId = null; }
            html.off();
            scroll.render().off();
            scroll.destroy();
            html.remove();
        };

        function buildHeader() {
            head.empty();
            quick.empty();
            active.empty();

            addHeadButton('Главная', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>', function () {
                openWith({
                    page: 1,
                    sort: readSettings().default_sort,
                    search: '',
                    status: '',
                    kind: '',
                    season: '',
                    genre: '',
                    genre_title: '',
                    mylist: ''
                });
            });

            if (isAuthorized()) addHeadButton('Профиль', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>', openProfile);

            addHeadButton('Поиск', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>', openSearch);
            addHeadButton('Фильтры', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>', openFilters);
            addHeadButton('Сезоны', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>', openSeasons);
            addHeadButton('Настройки', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>', openSettings);

            addQuick('Популярное', {
                sort: 'popularity',
                status: '',
                kind: '',
                season: '',
                genre: '',
                genre_title: '',
                search: '',
                mylist: ''
            });

            addQuick('Онгоинги', {
                status: 'ongoing',
                sort: 'popularity',
                kind: '',
                season: '',
                genre: '',
                genre_title: '',
                search: '',
                mylist: ''
            });

            addQuick('Анонсы', {
                status: 'anons',
                sort: 'popularity',
                kind: '',
                season: '',
                genre: '',
                genre_title: '',
                search: '',
                mylist: ''
            });

            addQuick('Фильмы', {
                kind: 'movie',
                sort: 'popularity',
                status: '',
                season: '',
                genre: '',
                genre_title: '',
                search: '',
                mylist: ''
            });

            if (
                params.search ||
                params.kind ||
                params.status ||
                params.season ||
                params.genre ||
                params.mylist ||
                (params.sort && params.sort !== readSettings().default_sort)
            ) {
                addQuick('Сброс', {
                    page: 1,
                    sort: readSettings().default_sort,
                    search: '',
                    status: '',
                    kind: '',
                    season: '',
                    genre: '',
                    genre_title: '',
                    mylist: ''
                }, true);
            }

            renderActive();
        }

        function bindPress(element, action) {
            var locked = false;

            var run = function () {
                if (locked) return;

                locked = true;

                setTimeout(function () {
                    locked = false;
                }, 280);

                action(element);
            };

            element.data('action', run);
            element.on('hover:enter click tap mouseup', run);

            element.on('keydown keyup', function (e) {
                var code = e.keyCode || e.which;

                if (code === 13 || code === 32) {
                    if (e.type === 'keyup') run();

                    e.preventDefault();

                    return false;
                }
            });
        }

        function addHeadButton(title, iconSvg, action) {
            var btn = $('<div class="simple-button selector Shikimori-head__button">' + iconSvg + '<span>' + esc(title) + '</span></div>');

            btn.on('hover:focus nav_focus', function () {
                last = btn[0];
            });

            bindPress(btn, action);
            head.append(btn);
        }

        function addQuick(title, values, reset) {
            var selected = !reset;

            if (selected) {
                for (var key in values) {
                    if (String(key === 'sort' ? (params[key] || readSettings().default_sort) : (params[key] || '')) !== String(values[key] || '')) {
                        selected = false;
                        break;
                    }
                }
            }

            var btn = $('<div class="simple-button selector Shikimori-chip' + (selected ? ' Shikimori-chip--active' : '') + '">' + esc(title) + '</div>');

            btn.on('hover:focus nav_focus', function () {
                last = btn[0];
            });

            bindPress(btn, function () {
                openWith(values);
            });

            quick.append(btn);
        }

        function renderActive() {
            var parts = [];

            var mylistMap = {
                planned: 'запланировано',
                watching: 'смотрю',
                rewatching: 'пересматриваю',
                completed: 'просмотрено',
                on_hold: 'отложено',
                dropped: 'брошено'
            };

            if (params.mylist) parts.push('список: ' + mylistMap[params.mylist]);
            if (params.search) parts.push('поиск: ' + params.search);
            if (params.kind) parts.push('тип: ' + kindName(params.kind));
            if (params.status) parts.push('статус: ' + statusName(params.status));
            if (params.season) parts.push('сезон: ' + seasonName(params.season));
            if (params.genre) parts.push('жанр: ' + (params.genre_title || params.genre));
            if (params.sort && params.sort !== readSettings().default_sort) parts.push('сортировка: ' + sortName(params.sort));

            active.html(parts.length ? '<span>Активно:</span> ' + esc(parts.join(' / ')) : '<span>Shikimori</span> быстрый каталог аниме');
        }

        function openWith(values) {
            var next = {};

            for (var key in params) {
                if (params[key] !== undefined && params[key] !== null && params[key] !== '') next[key] = params[key];
            }

            next.page = values.hasOwnProperty('page') ? values.page : 1;

            for (var key2 in values) {
                if (values[key2] === '') delete next[key2];
                else next[key2] = values[key2];
            }

            if (!next.genre) delete next.genre_title;
            if (!next.sort) next.sort = readSettings().default_sort;

            Lampa.Activity.push({
                url: '',
                title: 'Shikimori',
                component: 'shikimori',
                page: next.page,
                search: next.search || '',
                kind: next.kind || '',
                status: next.status || '',
                season: next.season || '',
                genre: next.genre || '',
                genre_title: next.genre_title || '',
                sort: next.sort || readSettings().default_sort,
                mylist: next.mylist || ''
            });
        }

        function openProfile() {
            withAccessToken(function (token) {
                var auth = readAuth();

                if (!auth.id) {
                    notify('Обновление данных профиля...');
                    loadWhoami();
                    return;
                }

                apiRequestAuth('GET', getShikiHost() + '/api/users/' + auth.id, null, token, function (user) {
                    var stats = (user.stats && user.stats.statuses && user.stats.statuses.anime) || [];
                    var map = {};

                    for (var i = 0; i < stats.length; i++) map[stats[i].name] = stats[i].size;

                    var items = [
                        { title: 'Смотрю (' + (map.watching || 0) + ')', value: 'watching' },
                        { title: 'Запланировано (' + (map.planned || 0) + ')', value: 'planned' },
                        { title: 'Пересматриваю (' + (map.rewatching || 0) + ')', value: 'rewatching' },
                        { title: 'Просмотрено (' + (map.completed || 0) + ')', value: 'completed' },
                        { title: 'Отложено (' + (map.on_hold || 0) + ')', value: 'on_hold' },
                        { title: 'Брошено (' + (map.dropped || 0) + ')', value: 'dropped' }
                    ];

                    Lampa.Select.show({
                        title: 'Профиль: ' + auth.nickname,
                        items: items,
                        onSelect: function (item) {
                            openWith({
                                mylist: item.value,
                                page: 1,
                                search: '',
                                status: '',
                                kind: '',
                                season: '',
                                genre: '',
                                genre_title: ''
                            });
                        },
                        onBack: function () {
                            Lampa.Controller.toggle('content');
                        }
                    });
                }, function () {
                    notify('Shikimori: не удалось загрузить профиль');
                });
            });
        }

        function openSearch(btnElement) {
            var value = params.search || '';

            if (window.Lampa && Lampa.Input && Lampa.Input.edit) {
                Lampa.Input.edit({
                    title: 'Поиск Shikimori',
                    value: value,
                    free: true
                }, function (text) {
                    text = String(text || '').trim();

                    if (!text) notify('Введите название аниме');
                    else openWith({
                        search: text
                    });

                    Lampa.Controller.toggle('content');

                    if (btnElement) {
                        Lampa.Controller.collectionSet(html);
                        Lampa.Controller.collectionFocus(btnElement, html);
                    }
                });
            } else {
                value = window.prompt('Поиск Shikimori', value);

                if (value !== null) {
                    value = String(value || '').trim();

                    if (value) openWith({
                        search: value
                    });
                    else notify('Введите название аниме');
                }
            }
        }

        function openFilters(genres) {
            var show = function (list) {
                var items = [
                    {
                        title: 'Сортировка: ' + sortName(params.sort || readSettings().default_sort),
                        value: 'sort'
                    },
                    {
                        title: 'Тип: ' + (params.kind ? kindName(params.kind) : 'любой'),
                        value: 'kind'
                    },
                    {
                        title: 'Статус: ' + (params.status ? statusName(params.status) : 'любой'),
                        value: 'status'
                    },
                    {
                        title: 'Жанр: ' + (params.genre_title || 'любой'),
                        value: 'genre'
                    }
                ];

                if (hasFilterSelection()) {
                    items.push({
                        title: 'Сбросить фильтры',
                        value: 'reset'
                    });
                }

                Lampa.Select.show({
                    title: 'Фильтры',
                    items: items,
                    onSelect: function (item) {
                        if (item.value === 'sort') openFilterSortMenu(list);
                        else if (item.value === 'kind') openFilterKindMenu(list);
                        else if (item.value === 'status') openFilterStatusMenu(list);
                        else if (item.value === 'genre') openFilterGenreMenu(list);
                        else if (item.value === 'reset') {
                            openWith({
                                sort: readSettings().default_sort,
                                kind: '',
                                status: '',
                                genre: '',
                                genre_title: '',
                                page: 1
                            });
                        }
                    },
                    onBack: function () {
                        Lampa.Controller.toggle('content');
                    }
                });
            };

            if (genres) show(genres);
            else loadGenres(show);
        }

        function hasFilterSelection() {
            return params.kind || params.status || params.genre ||
                (params.sort && params.sort !== readSettings().default_sort);
        }

        function openFilterSortMenu(genres) {
            var current = params.sort || readSettings().default_sort;
            var items = [
                { title: selectedTitle(!params.sort || params.sort === readSettings().default_sort, 'По умолчанию'), value: '' },
                { title: selectedTitle(current === 'popularity', 'Популярность'), value: 'popularity' },
                { title: selectedTitle(current === 'ranked', 'Рейтинг'), value: 'ranked' },
                { title: selectedTitle(current === 'aired_on', 'Дата выхода'), value: 'aired_on' }
            ];

            Lampa.Select.show({
                title: 'Сортировка',
                items: items,
                onSelect: function (item) {
                    openWith({ sort: item.value, page: 1 });
                },
                onBack: function () {
                    openFilters(genres);
                }
            });
        }

        function openFilterKindMenu(genres) {
            var current = params.kind || '';
            var items = [
                { title: selectedTitle(!current, 'Любой'), value: '' },
                { title: selectedTitle(current === 'tv', 'TV'), value: 'tv' },
                { title: selectedTitle(current === 'movie', 'Movie'), value: 'movie' },
                { title: selectedTitle(current === 'ova', 'OVA'), value: 'ova' },
                { title: selectedTitle(current === 'ona', 'ONA'), value: 'ona' },
                { title: selectedTitle(current === 'special', 'Special'), value: 'special' }
            ];

            Lampa.Select.show({
                title: 'Тип',
                items: items,
                onSelect: function (item) {
                    openWith({ kind: item.value, page: 1 });
                },
                onBack: function () {
                    openFilters(genres);
                }
            });
        }

        function openFilterStatusMenu(genres) {
            var current = params.status || '';
            var items = [
                { title: selectedTitle(!current, 'Любой'), value: '' },
                { title: selectedTitle(current === 'ongoing', 'Онгоинг'), value: 'ongoing' },
                { title: selectedTitle(current === 'anons', 'Анонс'), value: 'anons' },
                { title: selectedTitle(current === 'released', 'Вышло'), value: 'released' }
            ];

            Lampa.Select.show({
                title: 'Статус',
                items: items,
                onSelect: function (item) {
                    openWith({ status: item.value, page: 1 });
                },
                onBack: function () {
                    openFilters(genres);
                }
            });
        }

        function openFilterGenreMenu(genres) {
            var items = [
                { title: selectedTitle(!params.genre, 'Любой'), value: '' }
            ];

            for (var i = 0; i < genres.length; i++) {
                if (genres[i] && genres[i].id) {
                    var genreTitle = genres[i].russian || genres[i].name || genres[i].id;

                    items.push({
                        title: selectedTitle(String(params.genre || '') === String(genres[i].id), genreTitle),
                        value: String(genres[i].id),
                        genre_title: genreTitle
                    });
                }
            }

            if (items.length === 1) {
                items.push({ title: 'Жанры недоступны', value: 'noop' });
            }

            Lampa.Select.show({
                title: 'Жанры',
                items: items,
                onSelect: function (item) {
                    if (item.value === 'noop') return;

                    openWith({
                        genre: item.value,
                        genre_title: item.genre_title || '',
                        page: 1
                    });
                },
                onBack: function () {
                    openFilters(genres);
                }
            });
        }

        function openSeasons() {
            var now = new Date();
            var month = now.getMonth() + 1;
            var currentYear = now.getFullYear();

            var seasonsList = ['winter', 'spring', 'summer', 'fall'];
            var seasonsNames = ['Зима', 'Весна', 'Лето', 'Осень'];

            var currentIdx = 0;

            if (month >= 3 && month <= 5) currentIdx = 1;
            else if (month >= 6 && month <= 8) currentIdx = 2;
            else if (month >= 9 && month <= 11) currentIdx = 3;

            var nextIdx = (currentIdx + 1) % 4;
            var nextYear = currentYear + (currentIdx === 3 ? 1 : 0);

            var prev1Idx = (currentIdx + 3) % 4;
            var prev1Year = currentYear - (currentIdx === 0 ? 1 : 0);

            var prev2Idx = (prev1Idx + 3) % 4;
            var prev2Year = prev1Year - (prev1Idx === 0 ? 1 : 0);

            var items = [
                { title: seasonsNames[nextIdx] + ' ' + nextYear, value: seasonsList[nextIdx] + '_' + nextYear },
                { title: seasonsNames[currentIdx] + ' ' + currentYear, value: seasonsList[currentIdx] + '_' + currentYear },
                { title: seasonsNames[prev1Idx] + ' ' + prev1Year, value: seasonsList[prev1Idx] + '_' + prev1Year },
                { title: seasonsNames[prev2Idx] + ' ' + prev2Year, value: seasonsList[prev2Idx] + '_' + prev2Year },
                { title: currentYear + ' год', value: String(currentYear) },
                { title: (currentYear - 1) + ' год', value: String(currentYear - 1) },
                { title: (currentYear - 3) + '-' + (currentYear - 2), value: (currentYear - 3) + '_' + (currentYear - 2) },
                { title: (currentYear - 8) + '-' + (currentYear - 4), value: (currentYear - 8) + '_' + (currentYear - 4) },
                { title: '2010-' + (currentYear - 9), value: '2010_' + (currentYear - 9) },
                { title: '2000-2010', value: '2000_2010' }
            ];

            Lampa.Select.show({
                title: 'Сезоны',
                items: items,
                onSelect: function (item) {
                    openWith({
                        season: item.value
                    });
                },
                onBack: function () {
                    Lampa.Controller.toggle('content');
                }
            });
        }

        function titleLanguageName(lang) {
            if (lang === 'original') return 'оригинал';
            if (lang === 'en') return 'английский';
            return 'русский';
        }

        function selectedTitle(isSelected, title) {
            return (isSelected ? '✓ ' : '   ') + title;
        }

        function saveVisualSetting(key, value) {
            var settings = readSettings();
            settings[key] = value;
            saveSettings(settings);
            notify('Настройки Shikimori сохранены');
            openWith({
                page: 1,
                sort: settings.default_sort
            });
        }

        function openSettings(btnElement) {
            var settings = readSettings();

            var items = [
                {
                    title: 'Язык названий: ' + titleLanguageName(settings.title_language),
                    value: 'title_language'
                },
                {
                    title: 'Скрывать 18+: ' + (settings.hide_adult ? 'да' : 'нет'),
                    value: 'hide_adult'
                },
                {
                    title: 'Сортировка по умолчанию: ' + sortName(settings.default_sort),
                    value: 'default_sort'
                },
                {
                    title: 'Размер карточек: ' + (settings.card_size === 'compact' ? 'компактный' : 'обычный'),
                    value: 'card_size'
                },
                {
                    title: 'Домен Shikimori: ' + (settings.shiki_host || 'https://shikimori.io'),
                    value: 'shiki_host'
                },
                {
                    title: 'Очистить кэш поиска TMDB',
                    value: 'clear_tmdb_cache'
                },
                {
                    title: 'Авторизация: ' + authStatusTitle(),
                    value: 'auth'
                }
            ];

            Lampa.Select.show({
                title: 'Настройки Shikimori',
                items: items,
                onSelect: function (item) {
                    if (item.value === 'title_language') {
                        openTitleLanguageSettings(btnElement);
                        return;
                    } else if (item.value === 'hide_adult') {
                        openHideAdultSettings(btnElement);
                        return;
                    } else if (item.value === 'default_sort') {
                        openDefaultSortSettings(btnElement);
                        return;
                    } else if (item.value === 'card_size') {
                        openCardSizeSettings(btnElement);
                        return;
                    } else if (item.value === 'shiki_host') {
                        openShikiHostSettings(btnElement);
                        return;
                    } else if (item.value === 'clear_tmdb_cache') {
                        storageSet(TMDB_CACHE_KEY, {});
                        storageSet(POSTER_CACHE_KEY, {});
                        notify('Кэш поиска очищен');
                        Lampa.Controller.toggle('content');
                        return;
                    } else if (item.value === 'auth') {
                        openAuthSettings(btnElement);
                        return;
                    }
                },
                onBack: function () {
                    Lampa.Controller.toggle('content');
                }
            });
        }

        function openSelectMenu(key, title, items, transform, btnElement) {
            Lampa.Select.show({
                title: title,
                items: items,
                onSelect: function (item) {
                    saveVisualSetting(key, transform ? transform(item.value) : item.value);
                },
                onBack: function () {
                    openSettings(btnElement);
                }
            });
        }

        function openTitleLanguageSettings(btnElement) {
            var s = readSettings();
            openSelectMenu('title_language', 'Язык названий', [
                { title: selectedTitle(s.title_language === 'original', 'Оригинал'), value: 'original' },
                { title: selectedTitle(s.title_language === 'en', 'Английский'), value: 'en' },
                { title: selectedTitle(s.title_language === 'ru', 'Русский'), value: 'ru' }
            ], null, btnElement);
        }

        function openHideAdultSettings(btnElement) {
            var s = readSettings();
            openSelectMenu('hide_adult', 'Скрывать 18+', [
                { title: selectedTitle(s.hide_adult, 'Да'), value: 'true' },
                { title: selectedTitle(!s.hide_adult, 'Нет'), value: 'false' }
            ], function (v) { return v === 'true'; }, btnElement);
        }

        function openDefaultSortSettings(btnElement) {
            var s = readSettings();
            openSelectMenu('default_sort', 'Сортировка по умолчанию', [
                { title: selectedTitle(s.default_sort === 'popularity', 'Популярность'), value: 'popularity' },
                { title: selectedTitle(s.default_sort === 'ranked', 'Рейтинг'), value: 'ranked' },
                { title: selectedTitle(s.default_sort === 'aired_on', 'Дата выхода'), value: 'aired_on' }
            ], null, btnElement);
        }

        function openCardSizeSettings(btnElement) {
            var s = readSettings();
            openSelectMenu('card_size', 'Размер карточек', [
                { title: selectedTitle(s.card_size === 'normal', 'Обычный'), value: 'normal' },
                { title: selectedTitle(s.card_size === 'compact', 'Компактный'), value: 'compact' }
            ], null, btnElement);
        }

        function openShikiHostSettings(btnElement) {
            var settings = readSettings();
            var items = [
                { title: 'shikimori.io', value: 'https://shikimori.io' },
                { title: 'Ввести вручную', value: 'custom' }
            ];

            Lampa.Select.show({
                title: 'Домен Shikimori',
                items: items,
                onSelect: function (item) {
                    if (item.value === 'custom') {
                        askText('Домен Shikimori (с https://)', settings.shiki_host, function (value) {
                            if (value && value.indexOf('https://') === 0) {
                                settings.shiki_host = value.replace(/\/$/, '');
                                saveSettings(settings);
                                notify('Домен Shikimori изменён');
                            }
                        }, btnElement);
                    } else {
                        settings.shiki_host = item.value;
                        saveSettings(settings);
                        notify('Домен Shikimori изменён');
                    }
                },
                onBack: function () {
                    openSettings();
                }
            });
        }

        function openAuthSettings(btnElement, focusIndex) {
            var auth = readAuth();

            var items = [
                { title: 'Статус: ' + authStatusTitle(), value: 'whoami' },
                { title: 'Ввести Client ID', value: 'client_id' },
                { title: 'Ввести Client Secret', value: 'client_secret' },
                { title: 'Redirect URI: ' + auth.redirect_uri, value: 'redirect_uri' },
                { title: 'QR-код авторизации', value: 'qr' },
                { title: 'Скопировать ссылку авторизации', value: 'copy_url' },
                { title: 'Ввести код авторизации', value: 'code' },
                { title: 'Обновить токен', value: 'refresh' },
                { title: 'Выйти из Shikimori', value: 'logout' }
            ];

            Lampa.Select.show({
                title: 'Авторизация Shikimori',
                items: items,
                onSelect: function (item) {
                    if (item.value === 'qr') {
                        showAuthQrModal(btnElement);
                    } else if (item.value === 'client_id') {
                        askText('Client ID Shikimori', auth.client_id, function (value) {
                            auth.client_id = value;
                            saveAuth(auth);
                            notify('Client ID сохранён');
                        }, btnElement, function () { openAuthSettings(btnElement, 1); });
                    } else if (item.value === 'client_secret') {
                        askText('Client Secret Shikimori', auth.client_secret, function (value) {
                            auth.client_secret = value;
                            saveAuth(auth);
                            notify('Client Secret сохранён');
                        }, btnElement, function () { openAuthSettings(btnElement, 2); });
                    } else if (item.value === 'redirect_uri') {
                        askText('Redirect URI', auth.redirect_uri, function (value) {
                            auth.redirect_uri = value || defaultAuth().redirect_uri;
                            saveAuth(auth);
                            notify('Redirect URI сохранён');
                        }, btnElement, function () { openAuthSettings(btnElement, 3); });
                    } else if (item.value === 'copy_url') {
                        var url = authUrl();

                        if (!url) {
                            notify('Сначала введите Client ID');
                            return;
                        }

                        if (window.Lampa && Lampa.Utils && Lampa.Utils.copyTextToClipboard) {
                            Lampa.Utils.copyTextToClipboard(url, function () {
                                notify('Скопировано');
                            });
                        } else {
                            notify(url);
                        }
                    } else if (item.value === 'code') {
                        askText('Код авторизации', '', function (value) {
                            if (value) requestTokenByCode(value, loadWhoami);
                        }, btnElement, function () { openAuthSettings(btnElement, 6); });
                    } else if (item.value === 'refresh') {
                        refreshToken(function () {
                            loadWhoami();
                            openAuthSettings(btnElement);
                        });
                    } else if (item.value === 'whoami') {
                        loadWhoami();
                        openAuthSettings(btnElement);
                    } else if (item.value === 'logout') {
                        saveAuth(defaultAuth());
                        notify('Выход из Shikimori выполнен');

                        openWith({
                            page: 1,
                            sort: readSettings().default_sort,
                            mylist: ''
                        });
                    }
                },
                onBack: function () {
                    Lampa.Controller.toggle('content');
                }
            });

            if (typeof focusIndex === 'number' && focusIndex >= 0) {
                setTimeout(function () {
                    var selectors = $('.selectbox .selector');
                    if (selectors.length > focusIndex) {
                        Lampa.Controller.collectionFocus(selectors.eq(focusIndex)[0], $('.selectbox'));
                    }
                }, 100);
            }
        }

        function askText(title, value, callback, btnElement, onReturn) {
            if (window.Lampa && Lampa.Input && Lampa.Input.edit) {
                Lampa.Input.edit({
                    title: title,
                    value: value || '',
                    free: true
                }, function (text) {
                    callback(String(text || '').trim());

                    if (onReturn) {
                        onReturn();
                    } else {
                        Lampa.Controller.toggle('content');

                        if (btnElement) {
                            Lampa.Controller.collectionSet(html);
                            Lampa.Controller.collectionFocus(btnElement, html);
                        }
                    }
                });
            } else {
                value = window.prompt(title, value || '');

                if (value !== null) {
                    callback(String(value || '').trim());
                    if (onReturn) onReturn();
                }
            }
        }

        function load(append) {
            if (loading || (ended && append)) return;

            loading = true;

            body.find('.Shikimori-more').remove();

            if (!append) {
                body.empty();
                last = null;
            }

            body.append('<div class="Shikimori-loader' + (append ? ' Shikimori-loader--more' : '') + '">Загрузка...</div>');

            requestAnime(params, function (data) {
                loading = false;

                body.find('.Shikimori-loader').remove();

                if (!append) body.empty();

                if (!data.length) {
                    ended = true;

                    if (!append) body.append('<div class="Shikimori-empty">Ничего не найдено</div>');

                    return;
                }

                autoLoading = false;

                if (data.length < PAGE_LIMIT) ended = true;

                function renderCards() {
                    for (var i = 0; i < data.length; i++) appendCard(data[i]);

                    if (!ended) addMoreButton();

                    if (window.Lampa && Lampa.Controller) {
                        Lampa.Controller.collectionSet(html);
                        Lampa.Controller.collectionFocus(last || body.find('.selector').first(), html);
                    }
                }

                if (!append && isAuthorized() && !userRatesCache) {
                    fetchAllUserRates(function () { renderCards(); });
                } else {
                    renderCards();
                }
            }, function () {
                autoLoading = false;
                loading = false;

                body.find('.Shikimori-loader').remove();

                if (append) addMoreButton();
                else body.append('<div class="Shikimori-empty">Ошибка загрузки</div>');
            });
        }

        function appendCard(item) {
            var card = new Card(item);
            var render = card.render();

            render.data('card', card);

            render.on('hover:focus nav_focus', function () {
                last = render[0];
                scroll.update(render, true);
            });

            bindPress(render, function () {
                lastCardId = item.id;
                openAnime(item);
            });

            body.append(render);
        }

        function addMoreButton() {
            var more = $('<div class="simple-button selector Shikimori-more">Еще</div>');

            more.on('hover:focus nav_focus', function () {
                last = more[0];
                scroll.update(more, true);
            });

            bindPress(more, function () {
                loadNextPage(false);
            });

            body.append(more);
        }

        function loadNextPage(auto) {
            if (loading || ended || autoLoading) return;

            autoLoading = !!auto;
            params.page = (parseInt(params.page, 10) || 1) + 1;

            load(true);
        }
    }

    // ─── Full Page Integration ─────────────────────────────────────────

    /** Найти активный контейнер полной страницы. */
    function fullPage() {
        var page = $('.full-start-new, .full-start, .full').last();
        return page && page.length ? page : $();
    }

    /** Распаковать объект активности Lampa для получения внутренней активности. */
    function normalizeActivity(activity) {
        if (!activity) return {};
        if (activity.activity) return activity.activity;
        if (activity.object && activity.object.activity) return activity.object.activity;
        return activity;
    }

    /** Получить текущий активный объект активности Lampa. */
    function getActiveActivity() {
        var activity = null;

        try {
            if (window.Lampa && Lampa.Activity && typeof Lampa.Activity.active === 'function') {
                activity = Lampa.Activity.active();
            }
        } catch (e) {}

        activity = normalizeActivity(activity);

        if (activity && (activity.card || activity.id || activity.movie)) return activity;

        try {
            if (window.Lampa && Lampa.Activity && Lampa.Activity.activity) {
                activity = normalizeActivity(Lampa.Activity.activity);
            }
        } catch (e2) {}

        if (activity && (activity.card || activity.id || activity.movie)) return activity;

        return {};
    }

    /** Извлечь объект карточки/фильма из активности. */
    function getFullCard(activity) {
        activity = normalizeActivity(activity || getActiveActivity());

        var card = activity.card || activity.movie || activity.object || activity;

        if (!card || typeof card !== 'object') card = {};

        return card;
    }

    /** Получить основное название из карточки TMDB. */
    function getCardTitle(card, activity) {
        activity = activity || {};

        return card.title ||
            card.name ||
            card.original_title ||
            card.original_name ||
            activity.title ||
            activity.name ||
            '';
    }

    /** Извлечь год из объекта карточки TMDB. */
    function getCardYear(card) {
        var date = card.first_air_date || card.release_date || card.air_date || '';
        var year = 0;

        if (date) year = parseInt(String(date).substring(0, 4), 10);
        if (!year && card.release_year) year = parseInt(card.release_year, 10);
        if (!year && card.year) year = parseInt(card.year, 10);

        return year || 0;
    }

    /**
     * Маппинг ответа Shikimori (REST или GraphQL) во внутренний формат.
     * @param {Object} item - Объект аниме из API
     * @returns {Object|null} Маппинг данных аниме или null
     */
    function mapShikiAnime(item) {
        if (!item) return null;

        var poster = item.poster || {};

        return {
            id: item.id,
            name: item.name,
            russian: item.russian,
            english: item.english || '',
            japanese: item.japanese || '',
            kind: item.kind,
            score: item.score,
            status: item.status,
            season: item.season || '',
            genres: item.genres || [],
            airedOn: {
                year: item.airedOn && item.airedOn.year ? String(item.airedOn.year) :
                       item.aired_on ? String(item.aired_on).substring(0, 4) : ''
            },
            poster: {
                originalUrl: poster.originalUrl || poster.original_url || (item.image && item.image.original) || '',
                mainUrl: poster.mainUrl || poster.main_url || '',
                main2xUrl: poster.main2xUrl || poster.main_2x_url || '',
                previewUrl: poster.previewUrl || poster.preview_url || (item.image && item.image.preview) || '',
                miniUrl: poster.miniUrl || poster.mini_url || '',
                x96Url: poster.x96Url || poster.x96_url || (item.image && item.image.x96) || '',
                x48Url: poster.x48Url || poster.x48_url || (item.image && item.image.x48) || ''
            },
            image: item.image || null
        };
    }

    /** Загрузить аниме из Shikimori по ID через GraphQL. */
    function fetchShikiAnimeById(id, callback) {
        if (!id) {
            callback(null);
            return;
        }

        var query = '{ animes(ids: "' + String(id) + '") { ' +
            'id name russian english kind status score ' +
            'episodes episodesAired season ' +
            'poster { mainUrl main2xUrl previewUrl miniUrl originalUrl } ' +
            'genres { id name russian } ' +
            '} }';

        gqlQuery(query, function (data) {
            if (data && data.animes && data.animes.length) {
                callback(mapShikiAnime(data.animes[0]));
            } else {
                callback(null);
            }
        }, function () {
            callback(null);
        });
    }

    /** Поиск Shikimori по названию с матчем по годам. Используется для разрешения полной страницы. */
    function searchShikiAnimeByTitle(activity, callback) {
        var card = getFullCard(activity);
        var year = getCardYear(card);
        var queries = [];

        buildSmartQueries(card.title, queries);
        buildSmartQueries(card.name, queries);
        buildSmartQueries(card.original_title, queries);
        buildSmartQueries(card.original_name, queries);
        buildSmartQueries(activity && activity.title, queries);

        if (!queries.length) {
            callback(null);
            return;
        }

        var index = 0;

        function next() {
            if (index >= queries.length) {
                callback(null);
                return;
            }

            var query = queries[index++];
            var url = getShikiHost() + '/api/animes?limit=10&search=' + encodeURIComponent(query);

            apiGetJson(url, function (list) {
                var best = null;

                if (Array.isArray(list) && list.length) {
                    for (var i = 0; i < list.length; i++) {
                        var item = list[i];

                        if (!best) best = item;

                        if (year && item.aired_on) {
                            var itemYear = parseInt(String(item.aired_on).substring(0, 4), 10);
                            var isTv = item.kind === 'tv';

                            var isValidYear = false;
                            if (isTv) {
                                if (itemYear >= year - 2 && itemYear <= year + 20) {
                                    isValidYear = true;
                                }
                            } else {
                                if (Math.abs(itemYear - year) <= 2) {
                                    isValidYear = true;
                                }
                            }

                            if (isValidYear) {
                                best = item;
                                break;
                            }
                        } else if (!year) {
                            break;
                        }
                    }
                }

                if (best && best.id) callback(mapShikiAnime(best));
                else next();
            }, next);
        }

        next();
    }

    /**
     * Разрешить аниме Shikimori для полной страницы.
     * Цепочка: кешированные данные shikimori → ARM lookup → поиск по названию.
     * @param {Object} activity - Активность Lampa
     * @param {Function} callback - Вызывается с маппингом аниме или null
     */
    function resolveShikiAnimeForFull(activity, callback) {
        activity = normalizeActivity(activity || getActiveActivity());

        var card = getFullCard(activity);
        var shiki = card.shikimori || activity.shikimori || null;
        var tmdbId = card.id || activity.id || '';
        var cacheKey = '';

        if (shiki && shiki.id) {
            callback(shiki);
            return;
        }

        if (tmdbId) cacheKey = 'tmdb:' + tmdbId;
        else cacheKey = 'title:' + getCardTitle(card, activity);

        if (fullResolveCache[cacheKey]) {
            callback(fullResolveCache[cacheKey]);
            return;
        }

        function done(anime) {
            if (anime && anime.id) fullResolveCache[cacheKey] = anime;
            callback(anime || null);
        }

        if (tmdbId) {
            var url = ARM_HOST + '/api/v2/themoviedb?id=' + encodeURIComponent(tmdbId);

            apiGetJson(url, function (answer) {
                var mal = extractMalId(answer);

                if (mal) {
                    fetchShikiAnimeById(mal, function (anime) {
                        if (anime && anime.id) done(anime);
                        else searchShikiAnimeByTitle(activity, done);
                    });
                } else {
                    searchShikiAnimeByTitle(activity, done);
                }
            }, function () {
                searchShikiAnimeByTitle(activity, done);
            });
        } else {
            searchShikiAnimeByTitle(activity, done);
        }
    }

    /**
     * Запланировать добавление на полную страницу с задержками для повторных попыток.
     * Пробует на 300ms и 1500ms после загрузки страницы.
     * @param {Object} activity - Активность Lampa
     */
    function scheduleAppendFull(activity) {
        var delays = [300, 1500];
        var apiCalled = false;

        delays.forEach(function (delay) {
            setTimeout(function () {
                var page = fullPage();
                if (!page.length) return;
                if (page.find('.shikimori-full-list-button').length) return;

                if (!apiCalled) {
                    apiCalled = true;
                    resolveShikiAnimeForFull(activity || getActiveActivity(), function (anime) {
                        if (anime && anime.id) {
                            appendFull(getActiveActivity(), anime);
                        }
                    });
                }
            }, delay);
        });
    }

    /**
     * Подписка на жизненный цикл Lampa для внедрения контента Shikimori на полных страницах.
     * Слушает события 'full' и 'activity'. Опрашивает каждые 1.8с для поздно загружающихся страниц.
     */
    function extendFull() {
        if (!window.Lampa || !Lampa.Listener || !Lampa.Listener.follow) return;

        Lampa.Listener.follow('full', function (event) {
            fullResolveCache = {};

            if (fullPollId) { clearInterval(fullPollId); fullPollId = null; }

            var activity = event && event.object && event.object.activity ? event.object.activity : getActiveActivity();
            scheduleAppendFull(activity);

            fullPollId = setInterval(function () {
                var page = fullPage();
                if (!page.length) { clearInterval(fullPollId); fullPollId = null; return; }
                if (page.find('.shikimori-full-list-button').length) return;

                scheduleAppendFull(getActiveActivity());
            }, 1800);
        });

        Lampa.Listener.follow('activity', function () {
            scheduleAppendFull(getActiveActivity());
        });
    }

    /** Извлечь MAL ID из ответа ARM API (поддерживает разные форматы ответов). */
    function extractMalId(answer) {
        if (!answer) return '';

        if (answer.mal || answer.mal_id || answer.myanimelist) {
            return answer.mal || answer.mal_id || answer.myanimelist;
        }

        if (answer.ids && (answer.ids.mal || answer.ids.mal_id || answer.ids.myanimelist)) {
            return answer.ids.mal || answer.ids.mal_id || answer.ids.myanimelist;
        }

        if (answer.sources && answer.sources.myanimelist) {
            return answer.sources.myanimelist;
        }

        if (answer.length) {
            for (var i = 0; i < answer.length; i++) {
                if (answer[i] && (answer[i].myanimelist || answer[i].mal || answer[i].mal_id)) {
                    return answer[i].myanimelist || answer[i].mal || answer[i].mal_id;
                }
            }
        }

        return '';
    }

    /** Создать элемент кнопки списка Shikimori для полных страниц. */
    function createShikimoriFullListButton() {
        return $(
            '<div class="full-start__button full-start-new__button selector shikimori-full-list-button" title="Список Shikimori" aria-label="Список Shikimori" data-title="Список Shikimori">' +
                '<svg viewBox="0 0 64 64" width="1.75em" height="1.75em" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                    '<path d="M18 14h24c3.3 0 6 2.7 6 6v28c0 1.9-2.1 3-3.7 2L32 42.5 19.7 50c-1.6 1-3.7-.1-3.7-2V20c0-3.3 2.7-6 6-6Z" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>' +
                    '<path d="M25 25h14M25 33h14" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>' +
                '</svg>' +
                '<span class="shikimori-full-list-button__text">Список Shikimori</span>' +
            '</div>'
        );
    }

    /**
     * Внедрить оценку Shikimori и кнопку списка на полную страницу.
     * @param {Object} activity - Активность Lampa
     * @param {Object} anime - Маппинг данных аниме Shikimori
     */
    function appendFull(activity, anime) {
        var page = fullPage();

        if (!anime || !anime.id || !page.length) return;

        var score = anime.score && anime.score !== '0.0' ? anime.score : '—';

        if (!page.find('.rate--shikimori').length) {
            page.find('.full-start__rate-line, .full-start-new__rate-line').first().append(
                '<div class="rate rate--shikimori"><div>★ ' + esc(score) + '</div><span>Shikimori</span></div>'
            );
        }

        if (!page.find('.shikimori-full-list-button').length) {
            var buttons = page.find(
                '.full-start__buttons, ' +
                '.full-start-new__buttons, ' +
                '.full-start__buttons-line, ' +
                '.full-start-new__buttons-line, ' +
                '.full__buttons'
            ).first();

            var listBtn = createShikimoriFullListButton();

            if (buttons.length) {
                var children = buttons.children('.selector');

                if (children.length) {
                    children.last().before(listBtn);
                } else {
                    buttons.append(listBtn);
                }
            } else {
                var fallbackPlace = page.find('.full-start__body, .full-start-new__body, .full').first();

                if (fallbackPlace.length) fallbackPlace.append(listBtn);
                else page.append(listBtn);
            }

            initShikimoriListButton(listBtn, anime);

            setTimeout(function () {
                try {
                    if (window.Lampa && Lampa.Controller) {
                        Lampa.Controller.collectionSet(page);
                    }
                } catch (e) {}
            }, 100);
        }
    }

    // ─── Menu & Styles ─────────────────────────────────────────────────

    /**
     * Добавить пункт меню Shikimori в боковую панель Lampa.
     * Защита от дублирования.
     */
    function addMenu() {
        var menu = $('.menu .menu__list').eq(0);

        if (!menu.length || $('.menu__item.selector[data-action="shikimori"]').length) return;

        var button = $(
            '<li class="menu__item selector" data-action="shikimori">' +
                '<div class="menu__ico">' +
                    '<svg viewBox="0 0 24 24" width="44" height="44" fill="#c83a4b" xmlns="http://www.w3.org/2000/svg">' +
                        '<path d="M2.8025.0025C2.7779.03 2.8332.1223 2.9834.3c.0981.1134.1594.2328.233.4444.0551.1594.1198.3157.1443.3464.0368.049.0396.037.0427-.1102V.8181l.218.3004c.331.4568.5365.6992.6744.7973.0706.046.1136.0919.0952.098-.049.0153-.4785-.2208-.6778-.374-.1012-.0767-.196-.1411-.2114-.1411-.0153 0-.0644-.0461-.1073-.1013-.0399-.0552-.1348-.1408-.2053-.1898-.1717-.1196-.3527-.2913-.3957-.374C2.763.7721 2.668.7323 2.668.7814c0 .049.245.377.435.5793.5825.6224 1.1776.932 2.7688 1.4287.3373.1043.6347.2085.6623.233.0246.0215.0737.0398.1074.0398.0306 0 .0795.0152.104.0305.0399.0245.0367.031-.0093.031-.0368 0-.0521.018-.046.0548.0092.0552.1595.1045.4477.1444.1287.0184.1593.0124.1593-.0244 0-.049-.0889-.083-.2207-.083-.049 0-.0858-.0151-.0858-.0304 0-.0184.031-.025.0708-.0188.0368.0092.1652.0306.2817.052.276.046.353.0768.353.135 0 .0644.0826.092.1377.046.0307-.0276.046-.0274.046-.0028 0 .0183.0151.0337.0304.0337.0184 0 .031-.0214.031-.046 0-.0582-.0309-.0586.4842.0212.3066.046.42.077.374.0923-.098.0368-.0428.0858.0952.0858.0705 0 .1195.0153.1195.0337 0 .0276.0704.0306.2452.0183.1594-.0123.2516-.0093.2639.0122.0122.0184.0643.0275.1195.0183.0521-.0092.1961.0034.3126.0248.3066.0583 1.1313.1044 2.977.1688 2.983.1042 5.157.3277 5.9726.6159.3617.1287.9075.4048 1.0087.509.1594.1686.2082.3066.1898.5334-.0092.1135-.0092.2149 0 .2241.089.089.2855-.0859.2855-.2545 0-.0338.0639-.1165.1467-.187.331-.2913.3803-.454.3436-1.1194-.0246-.4476-.031-.4782-.2302-1.1343-.2606-.8585-.3215-.9903-.6342-1.3214-.3679-.3863-.7023-.6072-1.1592-.7635-.1103-.0368-.3434-.1224-.5212-.1899-.2483-.098-.4262-.141-.788-.1931-.512-.0736-1.6126-.1256-1.956-.0919-.1226.0123-.6132 0-1.1498-.0337-.61-.0337-.984-.046-1.0729-.0277-.0766.0154-.2085.0274-.2944.0305-.1257 0-.1837.0187-.291.0984-.1257.092-.2149.1194-.5644.1777-.5641.092-.929.1653-1.0823.2175-.1196.0429-.3157.0706-.6192.089-.8309.0521-1.3029.0952-1.4071.129-.0706.0214-.3406.0274-.7913.0182-.5488-.0123-.6895-.006-.7171.0277-.0276.0306-.0155.0398.0581.0398.1809 0 1.7968.1258 1.8121.141.0154.0154-.273.003-1.0977-.0491-.2423-.0154-.4567-.0186-.472-.0094-.0583.0368-.4939.0307-.9108-.0122-.515-.0521-1.0115-.138-1.4714-.2545-.2146-.0521-.4662-.0916-.644-.1008-.328-.0153-.6778-.129-1.1714-.3773-.325-.1625-.3614-.1684-.3614-.0366v.1008L3.244.5331c-.0552-.0644-.1224-.1689-.15-.2302-.0552-.1165-.2609-.328-.2915-.3004zm.4584 3.1887c-.5697.0269-1.0938.4707-1.47 1.2628-.2238.4752-.2635.6593-.2789 1.291-.0122.4966-.0063.598.0642 1.0119.1503.8615.19.9625.5058 1.2721.3342.3312 1.1654.785 1.6284.8892.1594.0338.3464.0768.4139.0952.2575.0644.61.0885 1.4868.1008.8431.0153.9136.0125 1.027-.0427.0797-.0398.2486-.0707.4908-.089.2023-.0184.4165-.0459.4748-.0643.0582-.0153.1841-.0309.276-.0309.0951 0 .1903-.0182.2087-.0366.0735-.0735.4228-.1503.757-.1687.187-.0092.3621-.0273.3928-.0427.1011-.0551.052-.0859-.1135-.0675-.095.0092-.187.003-.2207-.0154-.0491-.0307-.034-.0335.0825-.0366.0766 0 .2269-.0093.3342-.0216.1655-.0153.1842-.0248.1382-.0585-.1134-.0828-.0153-.1041.4936-.1041.4568 0 .5886-.0215.4537-.0736-.0275-.0092-.1413-.0216-.2517-.0216-.1134-.003-.1624-.0119-.1134-.015.0521-.006.1628-.0277.2517-.043.0859-.0185.6255-.0399 1.1958-.046.5702-.0061 1.0542-.0124 1.0757-.0155.0276 0 .0338-.0215.0216-.0614-.0123-.043-.0061-.061.0276-.061.0245 0 .083-.049.129-.1073.0919-.1195.1161-.1137.156.0427l.0277.1012.2207.0094c.1748.0061.2333-.003.2916-.046.0398-.0306.1224-.0645.1837-.0768l.1135-.0216-.0183.1782c-.0184.144-.0152.1716.0215.1593.0246-.0092.1222-.0338.2203-.0553l.1749-.0337-.0675-.089c-.043-.0491-.1226-.098-.1931-.1163l-.1224-.031.1838-.006a4.812 4.812 0 0 1 .3004 0c.0644.003.1135-.0089.1135-.0272 0-.0184-.0182-.034-.0366-.037-.0215-.0031-.089-.0064-.1472-.0095-.0582-.006-.1564-.0398-.2147-.0735-.0582-.0368-.1317-.067-.1593-.067-.0307 0-.0553-.0157-.0553-.031 0-.0215.092-.0305.2545-.0244.2483.0092.2514.0091.2606.0919.0123.095.0122.095.0797.0675a.0498.0498 0 0 0 .0305-.0581c-.0184-.049.037-.0893.083-.0586.0183.0092.0918.0215.1593.0276.1655.0092.9718.0737 1.1803.0952.1103.0122.1593.0307.1593.0614 0 .0521.037.0549.083.0089.0245-.0245.1442-.021.4354.0066.3557.0337.4017.0425.4017.0946 0 .0368.0213.0556.0704.0586.0368 0 .1656.0121.2821.0244.1196.0123.2329.0181.2513.009.0214-.0062.0891-.0979.1504-.2021.1196-.1993.2208-.3253.2607-.3253.0153 0 .018.0219.0089.0464-.0123.0245-.003.046.0154.046.0215 0 .0338.0244.0277.052-.0061.0367.0213.0582.0919.0735.1134.0246.1657.0582.089.0582-.0276 0-.0525.0183-.0525.0398 0 .0215.1812.0984.4448.1842.2821.095.4444.1623.4444.1899 0 .0306-.095.0092-.3586-.0797-.6254-.2146-.898-.2606-.898-.1533 0 .046.0488.0676.285.1228.1532.0368.3002.0642.3248.0642.0214 0 .0798.0338.1289.0736.049.043.294.144.5638.233.273.092.5153.19.5644.233.049.0398.1349.0952.1931.1166.1932.0828.4693.3309.6778.6099.3005.4047.2973.3895.1317.3895-.0766 0-.2946-.0214-.4847-.046-.19-.0245-.429-.0461-.53-.0492-.2147-.0061-1.9684.0278-2.6245.0493l-.4449.0154-.0703-.1504c-.0398-.0828-.1533-.2298-.2545-.331-.1747-.1717-.1837-.175-.2236-.1167-.0245.0337-.1168.1626-.2057.2822l-.1622.2236-.1992.0065c-.1104 0-.2242.0031-.2517 0-.0675-.006-.0703.0305-.009.144l.0427.0857-.3126.0216c-.8524.0582-2.661.282-3.268.4078-.135.0276-.4203.049-.6778.052-.46.0061-.5028.0184-.794.187-.0522.0276-.0922.0339-.129.0155-.0337-.0215-.0643-.0154-.0858.0122-.0337.0398-.144.058-.9534.1439-.1778.0184-.475.0584-.665.089-.3312.0552-.3499.0552-.5246 0-.184-.0582-.7572-.135-1.2478-.1687l-.276-.0216-.1622.1472c-.092.0797-.218.2177-.2855.3066-.092.1257-.141.166-.1992.166-.1257 0-1.2448.1743-2.0573.3215-.8768.1594-1.2077.1904-1.4652.1382-.2668-.0551-.2701-.0583-.2578-.3956.0122-.2851.0093-.2941-.0643-.3309-.1686-.0858-.331-.0371-.5517.1622-.052.046-.1133.0675-.1992.0675-.0705-.003-.1993.0306-.3004.0797l-.181.083.009.1593c.006.0858-.0032.1868-.0216.2175-.0245.0368-.0306.1994-.0183.4692.0123.328.003.4476-.0398.607l-.052.1964.1471.2086c.2943.4139.503.7294.503.763 0 .0185.0916.1169.208.218.506.4446.7207.5642 1.2174.6685.5273.1134.6131.1072.9412-.0675.1502-.0828.3251-.1965.3895-.2578.0797-.0736.3067-.1931.742-.3863.6776-.3004.7631-.3342.7631-.2943 0 .0122.043.426.0952.9135.1073 1.024.1411 2.0052.0951 2.7595-.0368.5917-.0644.6743-.4814 1.4591-.6469 1.2172-1.4224 2.3947-2.008 3.0477-.1043.1196-.2636.325-.3525.4599-.1686.2544-.4815.595-.871.9445-.1317.1195-.2177.2206-.2085.2451.0092.0245.1046.0734.2119.1102.1042.0398.2052.083.2236.0984.049.049.1101.0303.337-.0924l.2207-.1223.0891.0614c.1073.0705.3006.0763.4631.015.0644-.0245.1932-.052.2883-.0581.19-.0184.3126-.0703.5118-.2236.0736-.0552.1687-.1073.2147-.1195.089-.0184.8585-.7976 1.2694-1.2881.1287-.1502.4506-.4905.7204-.7542.3771-.374.5457-.5148.7603-.6436.3096-.184.5548-.4076.5854-.5395.0123-.046.052-.1413.0919-.2118.095-.1625.2024-.5792.1748-.6835-.0092-.0429-.0552-.147-.1012-.233-.0797-.141-.0855-.1901-.1008-.5826-.0276-.6898-.138-1.0515-.4875-1.5941-.2023-.3127-.2516-.4231-.3773-.8278-.2085-.696-.2697-1.3493-.1655-1.8613.049-.2545.0735-.2883.279-.4078.1072-.0644.2484-.1656.3159-.227l.1256-.1162.5948-.0675c.328-.0398.6958-.0889.8123-.1134.1196-.0245.3831-.0797.5855-.1195.2054-.043.497-.1164.6473-.1655.1502-.0521.3616-.1137.472-.1383.2146-.049.9472-.1192.9717-.0946.0092.0092.0185.4476.0155.975 0 .8277-.0092 1.0515-.0797 1.6616-.1196 1.0455-.1442 1.3732-.1749 2.526-.0276 1.1466-.0365 1.1986-.2236 1.3335-.1349.0981-.2728.0802-.6806-.1007-.2023-.089-.6286-.264-.9505-.3928-.3189-.1288-.7727-.3277-1.0027-.4411-.233-.1165-.4232-.2028-.4232-.1936 0 .0092.1165.1595.2606.3342.144.1748.2606.325.2606.3342 0 .0092-.0274.0188-.0642.0188-.0552 0-.0584.006-.0155.0642.0276.0398.0369.101.0277.1654-.0123.0828-.0032.1106.058.1505.04.0276.1046.1041.1445.1716.0368.0643.1012.147.141.1776.04.0307.098.1044.1318.1627.0306.0582.1348.1654.233.239.098.0736.193.1687.2113.2086.0184.046.1077.1133.2119.1655.2422.1226.5975.4353.6557.5732.0338.0859.1015.1534.2977.2822.1564.1042.4321.3433.7387.6469.558.5518.5887.5703 1.0425.5427.2943-.0214.4416-.0768.6164-.2362.0705-.0644.1563-.1316.187-.15.0306-.0184.1072-.1072.1655-.1992.0582-.095.147-.1932.193-.2208.1288-.0766.3587-.402.3587-.5062 0-.1533.0582-.251.2606-.441.1778-.1656.2149-.2213.3253-.4941.1717-.417.2326-.6864.2878-1.223.0674-.6622.0616-1.4623-.015-1.962-.1257-.8156-.604-3.0876-.7481-3.5414-.1196-.377-.233-.8676-.233-1.0087 0-.0337.064-.0369.3155-.0215.23.0153.4108.0094.6745-.0305.3127-.046.4202-.049.7514-.0183.2115.0184.3923.0396.3984.0488.0245.0214.4968 1.5575.5765 1.8702.1656.6408.1688.687.2025 2.2996.0153.8431.0304 1.8426.0366 2.2228.0061.6407.0124.7111.089.9932.0981.3587.2054.5919.4261.9108.089.1257.2238.3464.3005.4874.1533.2852.3527.521.6103.7172.3372.2606.6652.4724.8676.5644.2422.1103.4382.2849.6314.5577.0797.1104.1932.2609.2545.3375.0613.0767.1378.1932.1716.2607.0582.1226.0766.1348.4078.233.1532.0459.5762.0548.8123.015.1318-.0216.1812-.052.3928-.2574.285-.276.42-.469.42-.607 0-.2146.0303-.279.156-.3281.0798-.0307.1196-.0673.1196-.1041 0-.1932-.2023-.9723-.3066-1.1747-.0674-.1349-.9471-1.324-1.686-2.2836-.7849-1.0148-1.061-1.4567-1.2234-1.935-.0521-.1624-.2481-1.2754-.3708-2.143-.0889-.6224-.2608-1.2386-.5306-1.9223-.092-.233-.1564-.4228-.141-.4228.0735 0 1.6526.4415 1.7445.4875.0583.0307.2974.159.5274.2878.23.1318.4537.2363.4935.2363.046 0 .239.1073.466.2606l.3895.2606.2025-.0155c.2912-.0276.346-.0398.4687-.1256.1748-.1196.2792-.138.4172-.0736.2667.1257.4507.1472.2883.0338-.2422-.1687-.2667-.2516-.1257-.4632.1687-.2575.1867-.2757.3614-.3646.279-.141.2976-.1745.3895-.6774.043-.2452.1011-.4848.1257-.5338.0705-.1472.0553-.2419-.0642-.3553-.0614-.0583-.1627-.1904-.2302-.2916-.095-.1472-.1223-.2175-.1223-.3248 0-.1196-.0124-.144-.1013-.1992a1.3114 1.3114 0 0 0-.218-.1074c-.1318-.046-.3369-.2635-.3093-.3248a2.3155 2.3155 0 0 0 .0337-.083c.0246-.0613-.2239-.1962-.4692-.2545-.2452-.0582-.2421-.0583-.1992-.1073.0215-.0276.0212-.1227.0028-.3005-.092-.84-.4321-1.4285-.9993-1.7259-.1226-.0644-.2299-.1288-.239-.1471-.0583-.089-.7818-.365-1.1803-.4477-.1257-.0245-.3744-.0857-.5522-.1378-.1778-.049-.4504-.1016-.6098-.12-.4568-.043-1.073-.147-1.2754-.2114-.1012-.0307-.3403-.0858-.5335-.1195-.1931-.0368-.3587-.0766-.368-.0919-.0122-.0184-.0858-.0156-.187.0028-.1164.0215-.2912.0217-.5671-.0028-.2177-.0215-.7573-.034-1.1957-.031-.6745.0031-.8585-.0057-1.2019-.0609-.2207-.0368-.518-.0646-.659-.0646-.3373-.0031-1.331-.1042-1.1531-.1196.0276 0 .1195-.0181.2053-.0365.141-.0307.1504-.0372.1228-.0985-.0306-.0644-.0458-.0673-.478-.0642-.368 0-.4539.0094-.4815.0492-.0306.0399-.0615.0428-.1964.0183-.144-.0306-.1533-.0368-.1073-.0736.049-.0368.0492-.046.0094-.0736-.0246-.0153-.0676-.031-.0952-.031-.0399 0-1.9562-.19-2.7533-.2727-.1564-.0184-.2941-.0365-.3033-.0488-.0092-.0092.0061-.0154.0337-.0154.0307 0 .052-.0124.052-.0277 0-.046-.156-.058-.3707-.0244-.1502.0215-.2303.0213-.2794-.0032-.0582-.0246-.0395-.0273.0924-.015.2912.0306.1683-.0401-.1383-.077-.1656-.0214-.3372-.043-.3801-.0491a.486.486 0 0 1-.1379-.046c-.0306-.0184-.3679-.0763-.748-.1284-.3802-.0521-.8065-.1291-.9506-.172-.4967-.141-.9532-.371-1.2169-.607l-.1382-.1224.0492-.1167c.1011-.2422.2299-.3832.4598-.4936.3158-.1533.46-.178 1.0762-.1964.561-.0122.693-.0365.6286-.1101-.0307-.043-.472-.1106-.6928-.1106-.138 0-.4815-.0674-.7973-.1594a1.2257 1.2257 0 0 0-.4003-.0488zm8.8497 2.9503a.3051.3051 0 0 0-.0675.0051c-.181.0307-.285.0734-.3769.15l-.0919.0736.1472.0033c.1564 0 .239-.0306.3525-.1317.0713-.0644.0838-.0963.0366-.1003zm5.7762.951c.0383-.0023.0814.0089.1626.0319.092.0276.193.0401.2236.031.0307-.0093.0674-.0033.0797.0182.0153.0276-.0305.0308-.1838.0155-.1349-.0154-.2025-.0126-.2025.0089 0 .0184.0368.04.0858.0492.2238.049.2607.0737.0675.0553-.1103-.0123-.276-.0213-.368-.0244-.1594 0-.1684.003-.1776.0797-.0092.0705-.0307.0856-.181.1163-.2053.0398-.1775.0428-.3308-.0277-.138-.0674-.4418-.141-.819-.1992-.141-.0215-.2112-.0396-.1621-.0427.0521 0 .3342.0307.6286.0736.5457.0767.6988.0919.6651.0582-.0092-.0092-.2483-.0644-.5334-.1196l-.5151-.1012.3004-.0033c.2637-.003.3098.0064.3895.0647.0675.049.1011.0583.1256.0337.0215-.0214.1133-.028.2574-.0187.1931.0153.2452.0095.3525-.0488.0628-.0322.0966-.0483.135-.0506zm-4.3466.5128c.0152-.0005.0284.0022.036.0099.0124.0092.0002.0306-.0243.0459-.0582.0368-.0828.037-.1073.0033-.0138-.0253.0499-.0575.0956-.059zm4.9869.09c.0057-.002.0158.0105.0342.0366.0214.0276.0673.052.098.052.049 0 .0524.006.0126.0305-.0245.0153-.0522.0276-.0614.0276-.0613-.0061-.0919-.0428-.0919-.098.0015-.0306.0027-.0468.0085-.0487zm-3.9515.1805c-.0613 0-.104.052-.104.1256 0 .0153.0702.0276.156.0276.1472 0 .1536-.003.1168-.052-.0613-.0797-.0983-.1012-.1688-.1012zm6.1901 1.8304c.0215-.0092.0738.012.1167.0426.0675.0521.0674.0584.0122.0553-.0858 0-.184-.0765-.1289-.098Z"></path>' +
                    '</svg>' +
                '</div>' +
                '<div class="menu__text">Shikimori</div>' +
            '</li>'
        );

        button.on('hover:enter click tap mouseup', function () {
            Lampa.Activity.push({
                url: '',
                title: 'Shikimori',
                component: 'shikimori',
                page: 1,
                sort: readSettings().default_sort
            });
        });

        menu.append(button);
    }

    /**
     * Внедрить CSS стили плагина в страницу.
     * Защита по id #shikimori-style от повторной инъекции.
     */
    function addStyles() {
        if ($('#shikimori-style').length) return;

        $('body').append(
            '<style id="shikimori-style">' +
                '.Shikimori-module{padding:1.2em 1.5em 2.5em;color:#fff;height:100%;display:flex;flex-direction:column;box-sizing:border-box}' +
                '.Shikimori-module>.scroll{flex:1;overflow:hidden;position:relative;width:100%}' +
                '.Shikimori-module .scroll__body{width:100%}' +
                '.Shikimori-head{display:flex;flex-wrap:wrap;margin-bottom:0.8em;gap:0.3em;}' +
                '.Shikimori-quick{display:flex;flex-wrap:wrap;margin-bottom:0.8em;gap:0.25em;}' +
                '.Shikimori-head__button,.Shikimori-chip,.Shikimori-more{' +
                    'display:inline-flex!important;align-items:center!important;justify-content:center!important;' +
                    'padding:0.65em 1.2em!important;height:auto!important;line-height:1!important;' +
                    'background:rgba(255,255,255,0.06)!important;border:1px solid rgba(255,255,255,0.04)!important;' +
                    'color:rgba(255,255,255,0.85);font-size:0.95em;font-weight:500;margin:0 0.3em 0.3em 0!important;' +
                    'transition:all 0.2s ease-in-out;border-radius:0.5em!important;outline:none!important;box-shadow:none!important;' +
                '}' +
                '.Shikimori-chip{border-radius:1.5em!important;padding:0.5em 1.2em!important;font-size:0.88em;opacity:0.85;}' +
                '.Shikimori-head__button svg{width:1.15em;height:1.15em;margin-right:0.45em;opacity:0.85;flex-shrink:0;transition:transform 0.2s;}' +
                '.Shikimori-head__button.focus,.Shikimori-chip.focus,.Shikimori-more.focus{' +
                    'background:#c83a4b!important;color:#fff!important;' +
                    'border-color:#e95a68!important;transform:scale(1.05);' +
                    'box-shadow:0 0.4em 1.2em rgba(200,58,75,0.35)!important;' +
                '}' +
                '.Shikimori-head__button.focus svg{transform:scale(1.1);opacity:1;}' +
                '.Shikimori-chip--active{background:rgba(200,58,75,0.22)!important;border-color:rgba(200,58,75,0.55)!important;color:#ff8e9b!important;opacity:1;}' +
                '.Shikimori-active{font-size:1.05em;color:rgba(255,255,255,.62);margin:.15em 0 1em;line-height:1.35}' +
                '.Shikimori-active span{color:#e95a68;font-weight:600}' +
                '.Shikimori-body{display:-webkit-box;display:-ms-flexbox;display:flex;-webkit-box-orient:horizontal;-webkit-box-direction:normal;-ms-flex-flow:row wrap;flex-flow:row wrap;align-items:flex-start;justify-content:flex-start;padding:1em .5em}' +
                '.Shikimori.card{flex:0 0 14.285%;max-width:14.285%;padding:0 .6em;box-sizing:border-box;margin:0 0 1.5em 0;position:relative}' +
                '.Shikimori.card.Shikimori--compact{flex:0 0 10%;max-width:10%}' +
                '.Shikimori.card .card__view{background:#1b1d24;border-radius:.35em;overflow:hidden;position:relative;padding-bottom:145%}' +
                '.Shikimori.card .card__img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;display:block;background:#22252d}' +
                '.Shikimori.card.focus .card__view{box-shadow:0 0 0 .22em #fff,0 .4em 1.4em rgba(200,58,75,.45)}' +
                '.Shikimori-card__rating,.Shikimori-card__badge{position:absolute;top:.45em;padding:.25em .45em;border-radius:.25em;background:rgba(10,12,16,.82);font-size:.82em;line-height:1;color:#fff}' +
                '.Shikimori-card__rating{left:.45em;color:#ffd166}' +
                '.Shikimori-card__badge{right:.45em;color:#fff;background:rgba(200,58,75,.88)}' +
                '.Shikimori-card__user-rate{position:absolute;top:2.0em;left:.45em;padding:.25em .45em;border-radius:.25em;background:rgba(10,12,16,.82);font-size:.82em;line-height:1;color:#e95a68;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:85%}' +
                '.rate--shikimori{font-size:.82em}' +
                '.rate--shikimori>div{color:#ffd166}' +
                '.Shikimori.card .card__title{font-size:1.06em;line-height:1.22;max-height:2.55em;overflow:hidden;margin-top:.55em}' +
                '.Shikimori-card__meta{font-size:.88em;line-height:1.25;color:rgba(255,255,255,.52);height:2.35em;overflow:hidden;margin-top:.25em}' +
                '.Shikimori-loader,.Shikimori-empty{width:100%;text-align:center;font-size:1.2em;color:rgba(255,255,255,.68);padding:2em 0}' +
                '.Shikimori-loader--more{width:100%;font-size:1em;padding:1em 0;color:rgba(255,255,255,.48)}' +
                '.Shikimori-more{height:2.8em;line-height:2.8em;min-width:8em;text-align:center;margin-top:2em}' +
                '.shikimori-list-active{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.18);color:#fff}' +

                '.shikimori-qr-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center}' +
                '.shikimori-qr-modal{background:#1b1d24;border-radius:1em;padding:2em 2.5em;max-width:26em;width:90%;text-align:center;color:#fff;display:flex;flex-direction:column;align-items:center;gap:0.8em}' +
                '.shikimori-qr-title{font-size:1.4em;font-weight:700;color:#e95a68}' +
                '.shikimori-qr-hint{font-size:1em;color:rgba(255,255,255,.7);line-height:1.35}' +
                '.shikimori-qr-hint--small{font-size:.88em;color:rgba(255,255,255,.5);margin-top:0.3em}' +
                '.shikimori-qr-img-wrap{background:#fff;border-radius:.6em;padding:.6em;margin:.3em 0}' +
                '.shikimori-qr-img{display:block;width:250px;height:250px}' +
                '.shikimori-qr-buttons{display:flex;gap:.6em;margin-top:.4em;width:100%}' +
                '.shikimori-qr-btn{flex:1;padding:.65em .5em!important;font-size:.95em;text-align:center}' +
                '.shikimori-qr-btn--submit{background:#c83a4b!important;color:#fff!important}' +
                '.shikimori-qr-btn--copy{background:rgba(255,255,255,.1)!important;color:rgba(255,255,255,.8)!important}' +
                '.shikimori-qr-btn--close{background:rgba(255,255,255,.06)!important;color:rgba(255,255,255,.5)!important}' +
                '.shikimori-qr-btn.focus{transform:scale(1.05);box-shadow:0 0 1em rgba(200,58,75,.5)!important}' +

                '.full-start__button.shikimori-full-list-button,.full-start-new__button.shikimori-full-list-button,.shikimori-full-list-button{position:relative;color:#fff;background:rgba(0,0,0,.32)!important;border-color:transparent!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;vertical-align:middle!important;white-space:nowrap!important;overflow:visible!important}' +
                '.shikimori-full-list-button svg{display:block;pointer-events:none;flex:0 0 auto}' +
                '.shikimori-full-list-button__text{display:none;margin-left:.55em;font-size:.95em;font-weight:500;line-height:1;white-space:nowrap}' +
                '.full-start__button.shikimori-full-list-button.focus,.full-start-new__button.shikimori-full-list-button.focus,.shikimori-full-list-button.focus{background:#fff!important;color:#222!important;border-color:#fff!important;width:auto!important;min-width:0!important;padding-left:1.05em!important;padding-right:1.05em!important}' +
                '.shikimori-full-list-button.focus .shikimori-full-list-button__text{display:inline-block}' +
                '.shikimori-full-list-button.shikimori-list-active:not(.focus){background:rgba(255,255,255,.16)!important;color:#fff!important}' +
                '.shikimori-full-list-button.shikimori-list-loading{opacity:.75}' +
            '</style>'
        );
    }

    // ─── Entry Point ───────────────────────────────────────────────────

    /**
     * Точка входа плагина. Регистрирует компонент, хуки и меню.
     * Ждёт готовности Lampa при необходимости.
     */
    function start() {
        if (!window.Lampa || !window.$) return;

        addStyles();

        Lampa.Component.add('shikimori', Catalog);

        extendFull();

        if (window.appready) {
            addMenu();
        } else {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') addMenu();
            });
        }
    }

    start();
})();
