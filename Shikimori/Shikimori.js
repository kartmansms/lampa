(function () {
    'use strict';

    if (window.plugin_shikimori_ready) return;
    window.plugin_shikimori_ready = true;

    var SETTINGS_KEY = 'shikimori_settings_v2';
    var GENRES_CACHE_KEY = 'shikimori_genres_cache_v1';
    var TMDB_CACHE_KEY = 'shikimori_tmdb_cache_v1';
    var POSTER_CACHE_KEY = 'shikimori_poster_cache_v1';
    var AUTH_KEY = 'shikimori_auth_v1';

    var SHIKI_HOST = 'https://shikimori.io';
    var ARM_HOST = 'https://arm.haglund.dev';
    var PAGE_LIMIT = 48;

    var adultGenres = { hentai: true, erotica: true, yaoi: true, yuri: true };
    var posterRequests = {};
    var fullResolveCache = {};

    function defaults() {
        return {
            title_language: 'original',
            hide_adult: true,
            default_sort: 'popularity',
            card_size: 'normal',
            shiki_host: 'https://shikimori.one'
        };
    }

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

    function getShikiHost() {
        var settings = readSettings();
        return (settings.shiki_host || 'https://shikimori.one').replace(/\/$/, '');
    }

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

    function saveAuth(auth) {
        storageSet(AUTH_KEY, auth || defaultAuth());
    }

    function isAuthorized() {
        var auth = readAuth();
        return !!(auth.access_token && auth.expires_at && auth.expires_at > Date.now() + 60000);
    }

    function authStatusTitle() {
        var auth = readAuth();

        if (isAuthorized()) return 'подключено' + (auth.nickname ? ': ' + auth.nickname : '');
        if (auth.refresh_token) return 'требуется обновление';
        if (auth.client_id && auth.client_secret) return 'ключи введены';

        return 'не подключено';
    }

    function notify(message) {
        if (window.Lampa && Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(message);
        else if (window.console) console.log(message);
    }

    function esc(value) {
        value = value === undefined || value === null ? '' : String(value);

        return value.replace(/[&<>"']/g, function (symbol) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[symbol];
        });
    }

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

    function statusName(status) {
        var map = {
            anons: 'анонс',
            ongoing: 'онгоинг',
            released: 'вышло'
        };

        return map[status] || status || '';
    }

    function sortName(sort) {
        var map = {
            popularity: 'популярность',
            ranked: 'рейтинг',
            name: 'название',
            aired_on: 'дата выхода'
        };

        return map[sort] || sort || '';
    }

    function titleOf(data) {
        var settings = readSettings();

        if (settings.title_language === 'original') return data.name || data.english || data.russian || 'Shikimori';
        if (settings.title_language === 'en') return data.english || data.name || data.russian || 'Shikimori';

        return data.russian || data.name || data.english || 'Shikimori';
    }

    function originalTitleOf(data) {
        var settings = readSettings();

        if (settings.title_language === 'original') return data.russian || data.english || '';
        if (settings.title_language === 'en') return data.name || data.russian || '';

        return data.name || data.english || '';
    }

    function normalizePosterUrl(url) {
        url = url === undefined || url === null ? '' : String(url).trim();

        if (!url) return '';
        if (/^\/\//.test(url)) return 'https:' + url;
        
        if (/^https?:\/\//.test(url)) {
            return url.replace('shikimori.io', 'shikimori.one').replace('shikimori.me', 'shikimori.one');
        }

        return 'https://shikimori.one' + (url.indexOf('/') === 0 ? url : '/' + url);
    }

    function isBadPosterUrl(url) {
        url = String(url || '').toLowerCase();

        return !url ||
            url.indexOf('missing_original') !== -1 ||
            url.indexOf('missing_preview') !== -1 ||
            url.indexOf('missing_main') !== -1 ||
            url.indexOf('/assets/globals/missing') !== -1 ||
            url.indexOf('/images/missing') !== -1;
    }

    function pushPosterUrl(list, value) {
        var url = normalizePosterUrl(value);

        if (!url || isBadPosterUrl(url)) return;
        if (list.indexOf(url) === -1) list.push(url);
    }

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

    function posterOf(data) {
        var list = posterUrls(data);
        return list.length ? list[0] : '';
    }

    function tmdbPosterUrl(path) {
        path = path === undefined || path === null ? '' : String(path).trim();

        if (!path) return '';
        if (/^https?:\/\//.test(path)) return path;

        return 'https://image.tmdb.org/t/p/w342' + (path.indexOf('/') === 0 ? path : '/' + path);
    }

    function tmdbLanguage() {
        try {
            return window.Lampa && Lampa.Storage ? Lampa.Storage.get('language', 'ru') : 'ru';
        } catch (e) {
            return 'ru';
        }
    }

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

    function getAnimeYear(data) {
        return data && data.airedOn && data.airedOn.year ? parseInt(data.airedOn.year, 10) : 0;
    }

    function saveResolvedPoster(animeId, posterUrl) {
        var cache = storageGet(POSTER_CACHE_KEY, {});
        cache[animeId] = posterUrl || '';
        storageSet(POSTER_CACHE_KEY, cache);
    }

    function finishPosterRequest(animeId, posterUrl) {
        var callbacks = posterRequests[animeId] || [];
        delete posterRequests[animeId];

        saveResolvedPoster(animeId, posterUrl);

        for (var i = 0; i < callbacks.length; i++) {
            callbacks[i](posterUrl || '');
        }
    }

    function fetchTmdbDetailsPoster(data, tmdbId, type, callback) {
        var apiKey = '4ef0d7355d9ffb5151e987764708ce96';

        type = type === 'movie' ? 'movie' : 'tv';

        var url = 'https://api.themoviedb.org/3/' + type +
            '/' + encodeURIComponent(tmdbId) +
            '?api_key=' + apiKey +
            '&language=' + encodeURIComponent(tmdbLanguage());

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

    function resolvePosterByTmdbSearch(data, callback) {
        var apiKey = '4ef0d7355d9ffb5151e987764708ce96';
        var queries = [];
        var year = getAnimeYear(data);

        buildSmartQueries(data.english, queries);
        buildSmartQueries(data.name, queries);
        buildSmartQueries(data.russian, queries);

        if (!queries.length) {
            callback('');
            return;
        }

        var index = 0;

        function next() {
            if (index >= queries.length) {
                callback('');
                return;
            }

            var query = queries[index++];

            var url = 'https://api.themoviedb.org/3/search/multi?api_key=' + apiKey +
                '&language=' + encodeURIComponent(tmdbLanguage()) +
                '&query=' + encodeURIComponent(query);

            apiGetJson(url, function (res) {
                var results = res && res.results ? res.results : [];
                var best = null;

                for (var i = 0; i < results.length; i++) {
                    var item = results[i];

                    if ((item.media_type === 'tv' || item.media_type === 'movie') && item.poster_path) {
                        if (!best) best = item;

                        if (year) {
                            var itemYear = item.first_air_date
                                ? parseInt(item.first_air_date.substring(0, 4), 10)
                                : (item.release_date ? parseInt(item.release_date.substring(0, 4), 10) : 0);

                            var isValidYear = false;
                            if (item.media_type === 'tv') {
                                if (!itemYear || (year >= itemYear - 2 && year <= itemYear + 20)) {
                                    isValidYear = true;
                                }
                            } else {
                                if (!itemYear || Math.abs(itemYear - year) <= 2) {
                                    isValidYear = true;
                                }
                            }

                            if (isValidYear) {
                                best = item;
                                break;
                            }
                        } else {
                            break;
                        }
                    }
                }

                if (best && best.poster_path) {
                    var poster = tmdbPosterUrl(best.poster_path);
                    var tmdbCache = storageGet(TMDB_CACHE_KEY, {});

                    tmdbCache[data.id] = {
                        id: best.id,
                        type: best.media_type === 'movie' ? 'movie' : 'tv',
                        poster: poster
                    };

                    storageSet(TMDB_CACHE_KEY, tmdbCache);
                    callback(poster);
                } else {
                    next();
                }
            }, next);
        }

        next();
    }

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
                        finishPosterRequest(data.id, searchPoster);
                    });
                }
            });
            return;
        }

        var armUrl = ARM_HOST + '/api/v2/ids?source=myanimelist&id=' +
            encodeURIComponent(data.id) +
            '&include=themoviedb,myanimelist';

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

    function isAdultGenre(genre) {
        var name = String((genre && (genre.name || genre.russian)) || '').toLowerCase();
        return !!adultGenres[name];
    }

    function filterGenres(genres) {
        var settings = readSettings();
        var result = [];

        for (var i = 0; i < genres.length; i++) {
            if (genres[i] && genres[i].entry_type && genres[i].entry_type !== 'Anime') continue;
            if (!settings.hide_adult || !isAdultGenre(genres[i])) result.push(genres[i]);
        }

        return result;
    }

    function loadGenres(callback) {
        var cache = storageGet(GENRES_CACHE_KEY, []);

        if (cache && cache.length) {
            callback(filterGenres(cache));
            return;
        }

        var url = SHIKI_HOST + '/api/genres';

        var onSuccess = function (genres) {
            if (!genres || !genres.length) {
                callback([]);
                return;
            }

            storageSet(GENRES_CACHE_KEY, genres);
            callback(filterGenres(genres));
        };

        var onError = function () {
            callback([]);
        };

        if (window.Lampa && typeof Lampa.Reguest === 'function') {
            try {
                var network = new Lampa.Reguest();
                network.timeout(12000);
                network.silent(url, onSuccess, onError);
            } catch (e) {
                $.ajax({ url: url, dataType: 'json', timeout: 12000, success: onSuccess, error: onError });
            }
        } else {
            $.ajax({
                url: url,
                dataType: 'json',
                timeout: 12000,
                success: onSuccess,
                error: onError
            });
        }
    }

    function requestAnime(params, oncomplete, onerror) {
        var page = parseInt(params.page, 10) || 1;
        var sort = params.sort || readSettings().default_sort;

        var doREST = function (token) {
            var url = SHIKI_HOST + '/api/animes?limit=' + PAGE_LIMIT + '&page=' + page + '&order=' + encodeURIComponent(sort);

            if (params.search) url += '&search=' + encodeURIComponent(params.search);
            if (params.kind) url += '&kind=' + encodeURIComponent(params.kind);
            if (params.status) url += '&status=' + encodeURIComponent(params.status);
            if (params.season) url += '&season=' + encodeURIComponent(params.season);
            if (params.genre) url += '&genre=' + encodeURIComponent(params.genre);
            if (params.mylist) url += '&mylist=' + encodeURIComponent(params.mylist);

            var headers = {};
            if (token) headers.Authorization = 'Bearer ' + token;

            var onSuccess = function (data) {
                if (!Array.isArray(data)) {
                    if (data && data.errors) notify('Shikimori: Ошибка запроса к API');
                    oncomplete([]);
                    return;
                }

                var mapped = [];

                for (var i = 0; i < data.length; i++) {
                    var item = data[i];

                    mapped.push({
                        id: item.id,
                        name: item.name,
                        russian: item.russian,
                        english: item.english || '',
                        japanese: item.japanese || '',
                        kind: item.kind,
                        score: item.score,
                        status: item.status,
                        season: item.season || '',
                        airedOn: {
                            year: item.aired_on ? String(item.aired_on).substring(0, 4) : ''
                        },
                        poster: {
                            originalUrl: (item.poster && (item.poster.originalUrl || item.poster.original_url)) || (item.image && item.image.original) || '',
                            mainUrl: (item.poster && (item.poster.mainUrl || item.poster.main_url)) || '',
                            previewUrl: (item.poster && (item.poster.previewUrl || item.poster.preview_url)) || (item.image && item.image.preview) || '',
                            x96Url: (item.poster && (item.poster.x96Url || item.poster.x96_url)) || (item.image && item.image.x96) || '',
                            x48Url: (item.poster && (item.poster.x48Url || item.poster.x48_url)) || (item.image && item.image.x48) || ''
                        },
                        image: item.image || null
                    });
                }

                oncomplete(mapped);
            };

            var onError = function (xhr) {
                notify('Shikimori: не удалось загрузить каталог');
                if (onerror) onerror(xhr);
            };

            if (token) {
                $.ajax({
                    url: url,
                    method: 'GET',
                    headers: headers,
                    dataType: 'json',
                    timeout: 15000,
                    success: onSuccess,
                    error: onError
                });
            } else {
                apiGetJson(url, onSuccess, onError);
            }
        };

        if (params.mylist) withAccessToken(doREST);
        else doREST(null);
    }

    function openAnime(data) {
        var tmdbCache = storageGet(TMDB_CACHE_KEY, {});

        if (tmdbCache[data.id] && tmdbCache[data.id].id) {
            openTmdb({
                id: tmdbCache[data.id].id,
                media_type: tmdbCache[data.id].type
            }, data);
            return;
        }

        var url = ARM_HOST + '/api/v2/ids?source=myanimelist&id=' +
            encodeURIComponent(data.id) +
            '&include=themoviedb,myanimelist';

        var onSuccess = function (answer) {
            if (answer && answer.themoviedb) openTmdb(answer, data);
            else fallbackSearch(data);
        };

        apiGetJson(url, onSuccess, function () {
            fallbackSearch(data);
        });
    }

    function fallbackSearch(data) {
        var queries = [];

        buildSmartQueries(data.english, queries);
        buildSmartQueries(data.name, queries);
        buildSmartQueries(data.russian, queries);

        if (queries.length === 0) {
            openLampaSearch(data);
            return;
        }

        var currentIndex = 0;
        var shikiYear = data.airedOn && data.airedOn.year ? parseInt(data.airedOn.year, 10) : 0;

        function tryNextQuery() {
            if (currentIndex >= queries.length) {
                openLampaSearch(data);
                return;
            }

            var currentQuery = queries[currentIndex++];
            var apiKey = '4ef0d7355d9ffb5151e987764708ce96';
            var lang = (window.Lampa && Lampa.Storage) ? Lampa.Storage.get('language', 'ru') : 'ru';
            var baseUrl = 'https://api.themoviedb.org/3/';

            var url = baseUrl +
                'search/multi?api_key=' + apiKey +
                '&language=' + lang +
                '&query=' + encodeURIComponent(currentQuery);

            var handleSuccess = function (res) {
                if (res && res.results && res.results.length > 0) {
                    var bestItem = null;

                    for (var j = 0; j < res.results.length; j++) {
                        var item = res.results[j];

                        if (item.media_type === 'tv' || item.media_type === 'movie') {
                            if (!bestItem) bestItem = item;

                            if (shikiYear) {
                                var itemYear = item.first_air_date
                                    ? parseInt(item.first_air_date.substring(0, 4), 10)
                                    : (item.release_date ? parseInt(item.release_date.substring(0, 4), 10) : null);

                                var isValidYear = false;
                                if (item.media_type === 'tv') {
                                    // TMDB tv year is the start of Season 1.
                                    // Shikimori season year will be >= TMDB year.
                                    if (!itemYear || (shikiYear >= itemYear - 2 && shikiYear <= itemYear + 20)) {
                                        isValidYear = true;
                                    }
                                } else {
                                    if (!itemYear || Math.abs(itemYear - shikiYear) <= 2) {
                                        isValidYear = true;
                                    }
                                }

                                if (isValidYear) {
                                    bestItem = item;
                                    break;
                                }
                            } else {
                                break;
                            }
                        }
                    }

                    if (bestItem) openTmdb(bestItem, data);
                    else tryNextQuery();
                } else {
                    tryNextQuery();
                }
            };

            apiGetJson(url, handleSuccess, tryNextQuery);
        }

        notify('Поиск в базе...');
        tryNextQuery();
    }

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

        Lampa.Activity.push({
            url: '',
            title: movie.title,
            component: 'full',
            id: movie.id,
            method: type === 'movie' ? 'movie' : 'tv',
            card: movie,
            source: 'tmdb'
        });
    }

    function authUrl() {
        var auth = readAuth();

        if (!auth.client_id || !auth.redirect_uri) return '';

        return SHIKI_HOST +
            '/oauth/authorize?client_id=' + encodeURIComponent(auth.client_id) +
            '&redirect_uri=' + encodeURIComponent(auth.redirect_uri) +
            '&response_type=code&scope=user_rates';
    }

    function requestTokenByCode(code, callback) {
        var auth = readAuth();

        if (!auth.client_id || !auth.client_secret || !auth.redirect_uri) {
            notify('Введите Client ID, Client Secret и Redirect URI');
            return;
        }

        $.ajax({
            url: SHIKI_HOST + '/oauth/token',
            method: 'POST',
            dataType: 'json',
            timeout: 15000,
            data: {
                grant_type: 'authorization_code',
                client_id: auth.client_id,
                client_secret: auth.client_secret,
                code: code,
                redirect_uri: auth.redirect_uri
            },
            success: function (answer) {
                saveTokenAnswer(answer);
                if (callback) callback();
            },
            error: function () {
                notify('Shikimori: не удалось получить токен');
            }
        });
    }

    function refreshToken(callback) {
        var auth = readAuth();

        if (!auth.client_id || !auth.client_secret || !auth.refresh_token) {
            notify('Shikimori: нет данных для обновления токена');
            return;
        }

        $.ajax({
            url: SHIKI_HOST + '/oauth/token',
            method: 'POST',
            dataType: 'json',
            timeout: 15000,
            data: {
                grant_type: 'refresh_token',
                client_id: auth.client_id,
                client_secret: auth.client_secret,
                refresh_token: auth.refresh_token
            },
            success: function (answer) {
                saveTokenAnswer(answer);
                if (callback) callback();
            },
            error: function () {
                notify('Shikimori: не удалось обновить токен');
            }
        });
    }

    function saveTokenAnswer(answer) {
        var auth = readAuth();
        var expires = parseInt(answer && answer.expires_in, 10) || 86400;

        auth.access_token = answer && answer.access_token ? answer.access_token : '';
        auth.refresh_token = answer && answer.refresh_token ? answer.refresh_token : auth.refresh_token;
        auth.expires_at = Date.now() + expires * 1000;

        saveAuth(auth);
        notify('Авторизация Shikimori сохранена');
    }

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
    }

    function loadWhoami() {
        withAccessToken(function (token) {
            $.ajax({
                url: SHIKI_HOST + '/api/users/whoami',
                method: 'GET',
                dataType: 'json',
                timeout: 12000,
                headers: {
                    Authorization: 'Bearer ' + token
                },
                success: function (user) {
                    var auth = readAuth();

                    auth.id = user && user.id ? user.id : 0;
                    auth.nickname = user && user.nickname ? user.nickname : '';

                    saveAuth(auth);

                    notify(auth.nickname ? 'Shikimori: ' + auth.nickname : 'Shikimori: профиль получен');
                },
                error: function () {
                    notify('Shikimori: не удалось проверить профиль');
                }
            });
        });
    }

    function fetchUserRate(animeId, callback) {
        var auth = readAuth();

        if (!auth.id) {
            callback(null);
            return;
        }

        withAccessToken(function (token) {
            $.ajax({
                url: SHIKI_HOST + '/api/v2/user_rates?user_id=' + auth.id + '&target_id=' + animeId + '&target_type=Anime',
                method: 'GET',
                dataType: 'json',
                timeout: 10000,
                headers: {
                    Authorization: 'Bearer ' + token
                },
                success: function (res) {
                    callback(res && res.length ? res[0] : null);
                },
                error: function () {
                    callback(null);
                }
            });
        });
    }

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

            for (var k in data) payload.user_rate[k] = data[k];

            $.ajax({
                url: SHIKI_HOST + '/api/v2/user_rates' + (rateId ? '/' + rateId : ''),
                method: rateId ? 'PATCH' : 'POST',
                dataType: 'json',
                timeout: 10000,
                headers: {
                    Authorization: 'Bearer ' + token
                },
                data: payload,
                success: function (res) {
                    callback(res);
                },
                error: function (xhr) {
                    if (xhr.status === 403 || xhr.status === 401) {
                        notify('Ошибка прав! Выйдите из профиля и авторизуйтесь заново.');
                    } else {
                        notify('Ошибка сохранения в список Shikimori');
                    }
                }
            });
        });
    }

    function deleteUserRate(rateId, callback) {
        withAccessToken(function (token) {
            $.ajax({
                url: SHIKI_HOST + '/api/v2/user_rates/' + rateId,
                method: 'DELETE',
                timeout: 10000,
                headers: {
                    Authorization: 'Bearer ' + token
                },
                success: function () {
                    callback();
                },
                error: function (xhr) {
                    if (xhr.status === 403 || xhr.status === 401) {
                        notify('Ошибка прав! Выйдите из профиля и авторизуйтесь заново.');
                    } else {
                        notify('Ошибка удаления из Shikimori');
                    }
                }
            });
        });
    }

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

                if (currentRate.score) text += ' (★ ' + currentRate.score + ')';

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

                updateBtnLabel();

                notify('Удалено из списка Shikimori');
                Lampa.Controller.toggle('content');
            });
        }
    }

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
        var imgSrc = posterList.length ? esc(posterList[0]) : loadingSVG;

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
                    '</div>' +
                    '<div class="card__title">' + esc(titleOf(data)) + '</div>' +
                    '<div class="Shikimori-card__meta">' + esc(meta.join(' • ')) + '</div>' +
                '</div>'
            );

            installPosterFallback(element.find('.card__img'), posterList, noPosterSVG, data);

            return element;
        };
    }

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
                    Lampa.Controller.collectionFocus(last || html.find('.selector').first(), html);
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

                action();
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

                $.ajax({
                    url: SHIKI_HOST + '/api/users/' + auth.id,
                    method: 'GET',
                    dataType: 'json',
                    timeout: 12000,
                    headers: {
                        Authorization: 'Bearer ' + token
                    },
                    success: function (user) {
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
                    },
                    error: function () {
                        notify('Shikimori: не удалось загрузить профиль');
                    }
                });
            });
        }

        function openSearch() {
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

        function openSettings() {
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
                    title: 'Домен Shikimori: ' + (settings.shiki_host || 'https://shikimori.one'),
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
                        openTitleLanguageSettings();
                        return;
                    } else if (item.value === 'hide_adult') {
                        openHideAdultSettings();
                        return;
                    } else if (item.value === 'default_sort') {
                        openDefaultSortSettings();
                        return;
                    } else if (item.value === 'card_size') {
                        openCardSizeSettings();
                        return;
                    } else if (item.value === 'shiki_host') {
                        openShikiHostSettings();
                        return;
                    } else if (item.value === 'clear_tmdb_cache') {
                        storageSet(TMDB_CACHE_KEY, {});
                        storageSet(POSTER_CACHE_KEY, {});
                        notify('Кэш поиска очищен');
                        return;
                    } else if (item.value === 'auth') {
                        openAuthSettings();
                        return;
                    }
                },
                onBack: function () {
                    Lampa.Controller.toggle('content');
                }
            });
        }

        function openTitleLanguageSettings() {
            var settings = readSettings();
            var items = [
                { title: selectedTitle(settings.title_language === 'original', 'Оригинал'), value: 'original' },
                { title: selectedTitle(settings.title_language === 'en', 'Английский'), value: 'en' },
                { title: selectedTitle(settings.title_language === 'ru', 'Русский'), value: 'ru' }
            ];

            Lampa.Select.show({
                title: 'Язык названий',
                items: items,
                onSelect: function (item) {
                    saveVisualSetting('title_language', item.value);
                },
                onBack: function () {
                    openSettings();
                }
            });
        }

        function openHideAdultSettings() {
            var settings = readSettings();
            var items = [
                { title: selectedTitle(settings.hide_adult, 'Да'), value: 'true' },
                { title: selectedTitle(!settings.hide_adult, 'Нет'), value: 'false' }
            ];

            Lampa.Select.show({
                title: 'Скрывать 18+',
                items: items,
                onSelect: function (item) {
                    saveVisualSetting('hide_adult', item.value === 'true');
                },
                onBack: function () {
                    openSettings();
                }
            });
        }

        function openDefaultSortSettings() {
            var settings = readSettings();
            var items = [
                { title: selectedTitle(settings.default_sort === 'popularity', 'Популярность'), value: 'popularity' },
                { title: selectedTitle(settings.default_sort === 'ranked', 'Рейтинг'), value: 'ranked' },
                { title: selectedTitle(settings.default_sort === 'aired_on', 'Дата выхода'), value: 'aired_on' }
            ];

            Lampa.Select.show({
                title: 'Сортировка по умолчанию',
                items: items,
                onSelect: function (item) {
                    saveVisualSetting('default_sort', item.value);
                },
                onBack: function () {
                    openSettings();
                }
            });
        }

        function openCardSizeSettings() {
            var settings = readSettings();
            var items = [
                { title: selectedTitle(settings.card_size === 'normal', 'Обычный'), value: 'normal' },
                { title: selectedTitle(settings.card_size === 'compact', 'Компактный'), value: 'compact' }
            ];

            Lampa.Select.show({
                title: 'Размер карточек',
                items: items,
                onSelect: function (item) {
                    saveVisualSetting('card_size', item.value);
                },
                onBack: function () {
                    openSettings();
                }
            });
        }

        function openShikiHostSettings() {
            var settings = readSettings();
            var items = [
                { title: 'shikimori.one', value: 'https://shikimori.one' },
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
                        });
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

        function openAuthSettings() {
            var auth = readAuth();

            var items = [
                { title: 'Статус: ' + authStatusTitle(), value: 'whoami' },
                { title: 'Ввести Client ID', value: 'client_id' },
                { title: 'Ввести Client Secret', value: 'client_secret' },
                { title: 'Redirect URI: ' + auth.redirect_uri, value: 'redirect_uri' },
                { title: 'Скопировать ссылку авторизации', value: 'copy_url' },
                { title: 'Ввести код авторизации', value: 'code' },
                { title: 'Обновить токен', value: 'refresh' },
                { title: 'Выйти из Shikimori', value: 'logout' }
            ];

            Lampa.Select.show({
                title: 'Авторизация Shikimori',
                items: items,
                onSelect: function (item) {
                    if (item.value === 'client_id') {
                        askText('Client ID Shikimori', auth.client_id, function (value) {
                            auth.client_id = value;
                            saveAuth(auth);
                            notify('Client ID сохранён');
                        });
                    } else if (item.value === 'client_secret') {
                        askText('Client Secret Shikimori', auth.client_secret, function (value) {
                            auth.client_secret = value;
                            saveAuth(auth);
                            notify('Client Secret сохранён');
                        });
                    } else if (item.value === 'redirect_uri') {
                        askText('Redirect URI', auth.redirect_uri, function (value) {
                            auth.redirect_uri = value || defaultAuth().redirect_uri;
                            saveAuth(auth);
                            notify('Redirect URI сохранён');
                        });
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
                        });
                    } else if (item.value === 'refresh') {
                        refreshToken(loadWhoami);
                    } else if (item.value === 'whoami') {
                        loadWhoami();
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
        }

        function askText(title, value, callback) {
            if (window.Lampa && Lampa.Input && Lampa.Input.edit) {
                Lampa.Input.edit({
                    title: title,
                    value: value || '',
                    free: true
                }, function (text) {
                    callback(String(text || '').trim());
                });
            } else {
                value = window.prompt(title, value || '');

                if (value !== null) callback(String(value || '').trim());
            }
        }

        function load(append) {
            if (loading || ended && append) return;

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

                for (var i = 0; i < data.length; i++) appendCard(data[i]);

                if (!ended) addMoreButton();

                if (window.Lampa && Lampa.Controller) {
                    Lampa.Controller.collectionSet(html);
                    Lampa.Controller.collectionFocus(last || body.find('.selector').first(), html);
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

    function fullPage() {
        var page = $('.full-start-new, .full-start, .full').last();
        return page && page.length ? page : $();
    }

    function normalizeActivity(activity) {
        if (!activity) return {};
        if (activity.activity) return activity.activity;
        if (activity.object && activity.object.activity) return activity.object.activity;
        return activity;
    }

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

    function getFullCard(activity) {
        activity = normalizeActivity(activity || getActiveActivity());

        var card = activity.card || activity.movie || activity.object || activity;

        if (!card || typeof card !== 'object') card = {};

        return card;
    }

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

    function getCardYear(card) {
        var date = card.first_air_date || card.release_date || card.air_date || '';
        var year = 0;

        if (date) year = parseInt(String(date).substring(0, 4), 10);
        if (!year && card.release_year) year = parseInt(card.release_year, 10);
        if (!year && card.year) year = parseInt(card.year, 10);

        return year || 0;
    }

    function mapShikiAnime(item) {
        if (!item) return null;

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
            airedOn: {
                year: item.aired_on ? String(item.aired_on).substring(0, 4) : ''
            },
            poster: {
                originalUrl: (item.poster && (item.poster.originalUrl || item.poster.original_url)) || (item.image && item.image.original) || '',
                mainUrl: (item.poster && (item.poster.mainUrl || item.poster.main_url)) || '',
                previewUrl: (item.poster && (item.poster.previewUrl || item.poster.preview_url)) || (item.image && item.image.preview) || '',
                x96Url: (item.poster && (item.poster.x96Url || item.poster.x96_url)) || (item.image && item.image.x96) || '',
                x48Url: (item.poster && (item.poster.x48Url || item.poster.x48_url)) || (item.image && item.image.x48) || ''
            },
            image: item.image || null
        };
    }

    function fetchShikiAnimeById(id, callback) {
        if (!id) {
            callback(null);
            return;
        }

        apiGetJson(
            SHIKI_HOST + '/api/animes/' + encodeURIComponent(id),
            function (anime) {
                callback(anime && anime.id ? mapShikiAnime(anime) : null);
            },
            function () {
                callback(null);
            }
        );
    }

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
            var url = SHIKI_HOST + '/api/animes?limit=10&search=' + encodeURIComponent(query);

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

    function extendFull() {
        if (!window.Lampa || !Lampa.Listener || !Lampa.Listener.follow) return;

        Lampa.Listener.follow('full', function (event) {
            fullResolveCache = {}; // очищаем кэш при открытии новой full страницы
            var activity = event && event.object && event.object.activity ? event.object.activity : getActiveActivity();
            scheduleAppendFull(activity);
        });

        Lampa.Listener.follow('activity', function () {
            scheduleAppendFull(getActiveActivity());
        });

        setInterval(function () {
            var page = fullPage();
            if (!page.length) return;
            if (page.find('.shikimori-full-list-button').length) return;

            scheduleAppendFull(getActiveActivity());
        }, 1800);
    }

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

    function addMenu() {
        var menu = $('.menu .menu__list').eq(0);

        if (!menu.length || $('.menu__item.selector[data-action="shikimori"]').length) return;

        var button = $(
            '<li class="menu__item selector" data-action="shikimori">' +
                '<div class="menu__ico">' +
                    '<svg viewBox="0 0 44 44" width="44" height="44">' +
                        '<circle cx="22" cy="22" r="19" fill="#c83a4b"/>' +
                        '<path d="M13 29c2 3 5 5 9 5 6 0 10-3 10-8 0-4-2-6-8-8l-3-1c-3-1-4-2-4-4s2-3 5-3c3 0 5 1 7 3l3-4c-2-3-6-4-10-4-6 0-10 3-10 8 0 4 3 7 8 8l3 1c3 1 4 2 4 4s-2 3-5 3c-3 0-6-2-8-4l-1 4z" fill="#fff"/>' +
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
                '.Shikimori-card__rating,.Shikimori-card__badge{position:absolute;top:.45em;padding:.25em .45em;border-radius:.25em;background:rgba(10,12,16,.82);font-size:.9em;line-height:1;color:#fff}' +
                '.Shikimori-card__rating{left:.45em;color:#ffd166}' +
                '.Shikimori-card__badge{right:.45em;color:#fff;background:rgba(200,58,75,.88)}' +
                '.Shikimori-card__user-rate{position:absolute;top:2.35em;left:.45em;padding:.25em .45em;border-radius:.25em;background:rgba(10,12,16,.82);font-size:.82em;line-height:1;color:#2ecc71;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:85%}' +
                '.Shikimori.card .card__title{font-size:1.06em;line-height:1.22;max-height:2.55em;overflow:hidden;margin-top:.55em}' +
                '.Shikimori-card__meta{font-size:.88em;line-height:1.25;color:rgba(255,255,255,.52);height:2.35em;overflow:hidden;margin-top:.25em}' +
                '.Shikimori-loader,.Shikimori-empty{width:100%;text-align:center;font-size:1.2em;color:rgba(255,255,255,.68);padding:2em 0}' +
                '.Shikimori-loader--more{width:100%;font-size:1em;padding:1em 0;color:rgba(255,255,255,.48)}' +
                '.Shikimori-more{height:2.8em;line-height:2.8em;min-width:8em;text-align:center;margin-top:2em}' +
                '.shikimori-list-active{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.18);color:#fff}' +

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
