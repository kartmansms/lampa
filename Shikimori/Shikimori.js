(function () {
    'use strict';

    // --- 1. Читаемость, структура и современные практики ---

    // Вспомогательные функции, переименованные для ясности
    function getOwnKeys(object, includeSymbols) {
        const keys = Object.keys(object);
        if (Object.getOwnPropertySymbols) {
            let symbols = Object.getOwnPropertySymbols(object);
            if (includeSymbols) {
                symbols = symbols.filter(symbol => Object.getOwnPropertyDescriptor(object, symbol).enumerable);
            }
            keys.push(...symbols);
        }
        return keys;
    }

    function objectSpread(target) {
        for (let i = 1; i < arguments.length; i++) {
            const source = arguments[i] != null ? arguments[i] : {};
            if (i % 2) {
                getOwnKeys(Object(source), true).forEach(key => {
                    defineProperty(target, key, source[key]);
                });
            } else if (Object.getOwnPropertyDescriptors) {
                Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
            } else {
                getOwnKeys(Object(source)).forEach(key => {
                    Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
                });
            }
        }
        return target;
    }

    function defineProperty(obj, key, value) {
        key = toPropertyKey(key);
        if (key in obj) {
            Object.defineProperty(obj, key, {
                value: value,
                enumerable: true,
                configurable: true,
                writable: true
            });
        } else {
            obj[key] = value;
        }
        return obj;
    }

    function toPropertyKey(arg) {
        const key = toPrimitive(arg, "string");
        return typeof key === "symbol" ? key : String(key);
    }

    function toPrimitive(input, hint) {
        if (typeof input !== "object" || input === null) return input;
        const prim = input[Symbol.toPrimitive];
        if (prim !== undefined) {
            const res = prim.call(input, hint || "default");
            if (typeof res !== "object") return res;
            throw new TypeError("@@toPrimitive must return a primitive value.");
        }
        return (hint === "string" ? String : Number)(input);
    }

    // --- 2. Управление зависимостями ---
    // * regeneratorRuntime и полифилы для async/await остаются, так как они необходимы для транспиляции async/await в ES5.
    // * В идеале, это должно быть внешней зависимостью или обработано сборкой.
    // * Для улучшения читаемости, оставляем как есть, но понимаем, что это не идеально.

    // --- 3. Обработка ошибок ---
    // * Добавлены проверки существования свойств перед их использованием.
    // * Улучшена обработка ошибок в AJAX-запросах.

    // --- 4. Производительность ---
    // * Добавлено кэширование жанров Shikimori.
    // * Использование DocumentFragment не применимо в данном случае из-за Lampa.Template.

    // --- 6. Современные практики ---
    // * Использованы const/let.
    // * Использованы стрелочные функции и деструктуризация.
    // * Использованы шаблонные строки.
    // * Вынесены конфигурационные параметры (API-ключи, URL).
    // * Использован модульный паттерн для изоляции состояния.

    const SHIKI_PLUGIN_NAME = 'Shikimori';
    const SHIKI_API_URL = 'https://shikimori.one/api/graphql';
    const SHIKI_ANIME_API_URL = 'https://shikimori.one/api/animes/';
    const ARM_API_URL = 'https://arm.haglund.dev/api/v2';
    const TMDB_API_KEY = "4ef0d7355d9ffb5151e987764708ce96";
    const TMDB_API_URL = 'https://api.themoviedb.org/3/';
    const PROXY_DOMAIN = 'cub.red'; // Используется как fallback

    // --- Кэш ---
    let cachedGenres = null;

    // --- API функции ---
    const ShikimoriAPI = {
        async fetchAnimes(params, oncomplete, onerror) {
            const query = buildGraphQLQuery(params);
            try {
                const response = await $.ajax({
                    url: SHIKI_API_URL,
                    method: 'POST',
                    contentType: 'application/json',
                    data: JSON.stringify({ query })
                });
                if (response && response.data && response.data.animes) {
                    oncomplete(response.data.animes);
                } else {
                    console.warn('API вернул неожиданный формат данных:', response);
                    onerror(new Error('API вернул неожиданный формат данных'));
                }
            } catch (error) {
                console.error('Ошибка при запросе к Shikimori API:', error);
                onerror(error);
            }
        },

        async fetchAnimeDetails(malId) {
            try {
                const response = await $.ajax({
                    url: `${SHIKI_ANIME_API_URL}${malId}`,
                    method: 'GET',
                    timeout: 10000 // 10 секунд
                });
                return response;
            } catch (error) {
                console.error(`Ошибка при получении деталей аниме (MAL ID: ${malId}):`, error);
                throw error; // Передаем ошибку дальше для обработки
            }
        },

        async fetchGenres() {
            if (cachedGenres) {
                console.log('Возвращаем кэшированные жанры');
                return cachedGenres;
            }
            try {
                const response = await $.ajax({
                    url: `${ARM_API_URL}/genres`, // Исправлен URL для жанров
                    method: 'GET',
                    timeout: 10000
                });
                cachedGenres = response.filter(item => item.entry_type === "Anime");
                console.log('Жанры загружены и кэшированы');
                return cachedGenres;
            } catch (error) {
                console.error('Ошибка загрузки жанров:', error);
                throw error;
            }
        }
    };

    const TMDBAPI = {
        buildUrl(requestPath) {
            const proxyUrl = `apitmdb.${Lampa.Manifest?.cub_domain || PROXY_DOMAIN}/3/`;
            const baseUrl = Lampa.Storage.field('proxy_tmdb') ? Lampa.Utils.protocol() + proxyUrl : TMDB_API_URL;
            return baseUrl + requestPath;
        },

        async search(query, language = 'en-US') {
            const cleanQuery = this.cleanName(query);
            const request = `search/multi?api_key=${TMDB_API_KEY}&language=${language}&include_adult=true&query=${encodeURIComponent(cleanQuery)}`;
            try {
                const response = await $.get(this.buildUrl(request));
                return response;
            } catch (error) {
                console.error('Ошибка TMDB search:', error);
                return { total_results: 0, results: [] }; // Возвращаем пустой результат
            }
        },

        async getDetails(id, type = 'movie', language = 'en-US') {
            const request = `${type}/${id}?api_key=${TMDB_API_KEY}&language=${language}`;
            try {
                const response = await $.get(this.buildUrl(request));
                return response;
            } catch (error) {
                console.error('Ошибка TMDB get:', error);
                return null; // Возвращаем null в случае ошибки
            }
        },

        cleanName(name) {
            const regex = /\b(Season|Part)\s*\d*\.?\d*\b/gi;
            let cleanedName = name.replace(regex, '').trim();
            cleanedName = cleanedName.replace(/\s{2,}/g, ' ');
            return cleanedName;
        }
    };

    // --- Вспомогательные функции ---
    function buildGraphQLQuery(params) {
        let query = `
        query Animes {
            animes(limit: 36, order: ${params.sort || 'aired_on'}, page: ${params.page || 1}`;
        if (params.kind) query += `, kind: "${params.kind}"`;
        if (params.status) query += `, status: "${params.status}"`;
        if (params.genre) query += `, genre: "${params.genre}"`;
        if (params.seasons) query += `, season: "${params.seasons}"`;
        query += `) {
                id
                name
                russian
                licenseNameRu
                english
                japanese
                kind
                score
                status
                season
                airedOn { year }
                poster { originalUrl }
            }
        }`;
        return query;
    }

    function getLanguageCode() {
        return Lampa.Storage.field('language') || 'en';
    }

    // --- Карточка аниме ---
    function ShikimoriCard(data, userLang) {
        const typeTranslations = {
            'tv': 'ТВ',
            'movie': 'Фильм',
            'ova': 'OVA',
            'ona': 'ONA',
            'special': 'Спешл',
            'tv_special': 'ТВ Спешл',
            'music': 'Музыка',
            'pv': 'PV',
            'cm': 'CM'
        };

        const statusTranslations = {
            'anons': 'Анонс',
            'ongoing': 'Онгоинг',
            'released': 'Вышло'
        };

        const formattedSeason = data.season ? data.season
            .replace(/_/g, ' ')
            .replace(/^\w/, c => c.toUpperCase())
            .replace(/(winter|spring|summer|fall)/gi, match => {
                const seasonMap = {
                    'winter': 'Зима',
                    'spring': 'Весна',
                    'summer': 'Лето',
                    'fall': 'Осень'
                };
                return seasonMap[match.toLowerCase()];
            }) : '';

        const item = Lampa.Template.get("Shikimori-Card", {
            img: data.poster?.originalUrl || Lampa.Utils.cardImg({ poster: null }), // Обработка отсутствия постера
            type: typeTranslations[data.kind] || data.kind.toUpperCase(),
            status: statusTranslations[data.status] || data.status.charAt(0).toUpperCase() + data.status.slice(1),
            rate: data.score || 'N/A',
            title: userLang === 'ru' ? data.russian || data.name || data.japanese : data.name || data.japanese,
            season: data.season !== null ? formattedSeason : data.airedOn?.year || 'N/A'
        });

        this.render = function () {
            return item;
        };

        this.destroy = function () {
            item.remove();
        };
    }

    // --- Основной компонент ---
    function ShikimoriComponent(object) {
        const userLang = getLanguageCode();
        const network = new Lampa.Reguest();
        const scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        const items = [];
        const html = $(`<div class='Shikimori-module'></div>`);
        const head = $(`<div class='Shikimori-head torrent-filter'>
            <div class='Shikimori__home simple-button simple-button--filter selector'>Главная</div>
            <div class='Shikimori__search simple-button simple-button--filter selector'>Фильтр</div>
        </div>`);
        const body = $(`<div class="Shikimori-catalog--list category-full"></div>`);

        let activeItemIndex, lastFocusedElement;

        this.create = function () {
            ShikimoriAPI.fetchAnimes(object, this.build.bind(this), this.empty.bind(this));
        };

        this.build = function (result) {
            scroll.minus();
            scroll.onWheel = (step) => {
                if (!Lampa.Controller.own(this)) this.start();
                if (step > 0) Navigator.move('down');
                else Navigator.move('up');
            };
            scroll.onEnd = () => {
                object.page = object.page || 1;
                object.page++;
                ShikimoriAPI.fetchAnimes(object, this.build.bind(this), this.empty.bind(this));
            };

            this.headeraction();
            this.body(result);
            scroll.append(head);
            scroll.append(body);
            html.append(scroll.render(true));
            this.activity.loader(false);
            this.activity.toggle();
        };

        this.headeraction = function () {
            const filters = {
                kind: { title: 'Жанр', items: [] },
                AnimeKindEnum: {
                    title: 'Тип',
                    items: [
                        { title: "ТВ Сериал", code: "tv" },
                        { title: "Фильм", code: "movie" },
                        { title: "OVA", code: "ova" },
                        { title: "ONA", code: "ona" },
                        { title: "Спешл", code: "special" },
                        { title: "ТВ Спешл", code: "tv_special" },
                        { title: "Музыка", code: "music" },
                        { title: "PV", code: "pv" },
                        { title: "CM", code: "cm" }
                    ]
                },
                status: {
                    title: 'Статус',
                    items: [
                        { title: "Анонс", code: "anons" },
                        { title: "Онгоинг", code: "ongoing" },
                        { title: "Вышло", code: "released" }
                    ]
                },
                sort: {
                    title: 'Сортировка',
                    items: [
                        { title: "По рейтингу", code: "ranked" },
                        { title: "По популярности", code: "popularity" },
                        { title: "По алфавиту", code: "name" },
                        { title: "По дате выхода", code: "aired_on" },
                        { title: "По типу", code: "kind" },
                        { title: "По количеству эпизодов", code: "episodes" },
                        { title: "По статусу", code: "status" },
                        { title: "По рейтингу Shikimori", code: "ranked_shiki" }
                    ]
                },
                seasons: {
                    title: 'Сезон',
                    items: generateSeasonJSON()
                }
            };

            // Загрузка жанров асинхронно
            ShikimoriAPI.fetchGenres()
                .then(genres => {
                    const genreTranslations = {
                        "Action": "Экшен",
                        "Adventure": "Приключения",
                        "Cars": "Машины",
                        "Comedy": "Комедия",
                        "Dementia": "Деменция",
                        "Demons": "Демоны",
                        "Drama": "Драма",
                        "Ecchi": "Этти",
                        "Fantasy": "Фэнтези",
                        "Game": "Игра",
                        "Harem": "Гарем",
                        "Historical": "Исторический",
                        "Horror": "Ужасы",
                        "Josei": "Дзёсей",
                        "Kids": "Детский",
                        "Magic": "Магия",
                        "Martial Arts": "Боевые искусства",
                        "Mecha": "Меха",
                        "Military": "Военный",
                        "Music": "Музыка",
                        "Mystery": "Мистика",
                        "Parody": "Пародия",
                        "Police": "Полиция",
                        "Psychological": "Психологический",
                        "Romance": "Романтика",
                        "Samurai": "Самурайский",
                        "School": "Школьный",
                        "Sci-Fi": "Научная фантастика",
                        "Seinen": "Сейнэн",
                        "Shoujo": "Сёдзё",
                        "Shoujo Ai": "Сёдзё-ай",
                        "Shounen": "Сёнэн",
                        "Shounen Ai": "Сёнэн-ай",
                        "Slice of Life": "Повседневность",
                        "Space": "Космос",
                        "Sports": "Спорт",
                        "Super Power": "Суперсила",
                        "Supernatural": "Сверхъестественное",
                        "Thriller": "Триллер",
                        "Erotica": "Эротика",
                        "Hentai": "Хентай",
                        "Yaoi": "Яой",
                        "Yuri": "Юри",
                        "Gourmet": "Гурман",
                        "Work Life": "Трудяги",
                        "Vampire": "Вампиры"
                    };
                    filters.kind.items = genres.map(item => ({
                        ...item,
                        title: genreTranslations[item.name] || item.name,
                        name: undefined // Удаляем оригинальное поле name
                    }));
                })
                .catch(error => {
                    console.error('Не удалось загрузить жанры:', error);
                });

            const serverElement = head.find('.Shikimori__search');
            const homeElement = head.find('.Shikimori__home');

            function queryForShikimori() {
                const query = {};
                for (const key in filters) {
                    const selected = filters[key].items.find(item => item.selected);
                    if (selected) {
                        if (key === 'kind') query.genre = selected.id; // genre ID
                        else query[key] = selected.code; // kind, status, sort, seasons
                    }
                }
                return query;
            }

            function updateFilterSubtitle(filter) {
                const selectedTitles = filter.items.filter(item => item.selected).map(item => item.title);
                filter.subtitle = selectedTitles.length ? selectedTitles.join(', ') : Lampa.Lang.translate('nochoice');
            }

            function selectItem(filterItems, selected) {
                filterItems.forEach(item => item.selected = false);
                selected.selected = true;
            }

            function showSubmenu(filter, backCallback) {
                Lampa.Select.show({
                    title: filter.title,
                    items: filter.items,
                    onBack: backCallback,
                    onSelect: (selectedItem) => {
                        selectItem(filter.items, selectedItem);
                        backCallback(); // Возвращаемся к меню фильтров
                    }
                });
            }

            function showMainMenu() {
                for (const key in filters) {
                    updateFilterSubtitle(filters[key]);
                }

                const menuItems = [
                    { title: Lampa.Lang.translate('search_start'), searchShikimori: true },
                    filters.status,
                    filters.AnimeKindEnum,
                    filters.kind, // Жанры
                    filters.sort,
                    filters.seasons
                ];

                Lampa.Select.show({
                    title: 'Фильтры',
                    items: menuItems,
                    onBack: () => Lampa.Controller.toggle("content"),
                    onSelect: (selectedItem) => {
                        if (selectedItem.searchShikimori) {
                            performSearch();
                        } else {
                            showSubmenu(selectedItem, showMainMenu);
                        }
                    }
                });
            }

            function performSearch() {
                const query = queryForShikimori();
                const params = {
                    url: '',
                    title: 'Shikimori',
                    component: SHIKI_PLUGIN_NAME,
                    page: 1
                };
                if (query.kind) params.kind = query.kind;
                if (query.status) params.status = query.status;
                if (query.genre) params.genre = query.genre;
                if (query.sort) params.sort = query.sort;
                if (query.seasons) params.seasons = query.seasons;

                Lampa.Activity.push(params);
            }

            serverElement.on('hover:enter', showMainMenu);
            homeElement.on('hover:enter', () => {
                Lampa.Activity.push({
                    url: '',
                    title: 'Shikimori',
                    component: SHIKI_PLUGIN_NAME,
                    page: 1
                });
            });
        };

        this.empty = function () {
            const empty = new Lampa.Empty();
            html.append(empty.render(true));
            this.start = empty.start;
            this.activity.loader(false);
            this.activity.toggle();
        };

        this.body = function (data) {
            data.forEach((anime, index) => { // Добавлен index для идентификации
                const item = new ShikimoriCard(anime, userLang);
                const cardElement = item.render(true);

                cardElement.on("hover:focus", () => {
                    lastFocusedElement = cardElement[0];
                    activeItemIndex = items.length + index; // Индекс в глобальном массиве items
                    if (items[activeItemIndex]) { // Проверка на существование
                        scroll.update(items[activeItemIndex].render(true), true);
                    }
                });

                cardElement.on("hover:enter", async () => {
                    try {
                        await searchExternalInfo(anime);
                    } catch (error) {
                        console.error('Ошибка при поиске внешней информации:', error);
                    }
                });

                body.append(cardElement);
                items.push(item);
            });
        };

        // --- Поиск внешней информации ---
        async function searchExternalInfo(animeData) {
            try {
                // 1. Получаем ID из ARM API
                let armResponse = null;
                try {
                    armResponse = await $.get(`${ARM_API_URL}/ids?source=myanimelist&id=${animeData.id}`);
                } catch (jqXHR) {
                    if (jqXHR.status === 404) {
                        console.log(`ARM API вернул 404 для MAL ID ${animeData.id}, пробуем TMDB.`);
                    } else {
                        console.error(`Ошибка ARM API: ${jqXHR.status}`);
                    }
                }

                let tmdbResult = null;

                if (armResponse && armResponse.themoviedb) {
                    console.log('Получен TMDB ID из ARM API, запрашиваем детали...');
                    tmdbResult = await TMDBAPI.getDetails(armResponse.themoviedb, animeData.kind === 'movie' ? 'movie' : 'tv', getLanguageCode());
                } else {
                    console.log('TMDB ID не найден в ARM API, ищем через TMDB search...');
                    const searchResult = await TMDBAPI.search(animeData.name, getLanguageCode());
                    if (searchResult.total_results > 0) {
                        if (searchResult.total_results === 1) {
                            tmdbResult = searchResult.results[0];
                        } else {
                            // Если найдено несколько, показываем выбор пользователю
                            const menuItems = searchResult.results.map(animeItem => ({
                                title: `[${animeItem.media_type.toUpperCase()}] ${animeItem.name || animeItem.title}`,
                                card: animeItem
                            }));

                            Lampa.Select.show({
                                title: 'Найти',
                                items: menuItems,
                                onBack: () => Lampa.Controller.toggle("content"),
                                onSelect: (selectedItem) => {
                                    Lampa.Activity.push({
                                        url: '',
                                        component: 'full',
                                        id: selectedItem.card.id,
                                        method: selectedItem.card.media_type,
                                        card: selectedItem.card
                                    });
                                }
                            });
                            return; // Выходим, так как выбор передан пользователю
                        }
                    } else {
                        // Если не найдено по оригинальному названию, пробуем японское
                        const fallbackSearch = await TMDBAPI.search(animeData.japanese, getLanguageCode());
                        if (fallbackSearch.total_results > 0 && fallbackSearch.total_results === 1) {
                            tmdbResult = fallbackSearch.results[0];
                        }
                    }
                }

                if (tmdbResult) {
                    Lampa.Activity.push({
                        url: '',
                        component: 'full',
                        id: tmdbResult.id,
                        method: tmdbResult.number_of_episodes ? 'tv' : 'movie', // Простое определение типа
                        card: tmdbResult
                    });
                } else {
                    Lampa.Noty.show('Не удалось найти данные в TMDB');
                }
            } catch (error) {
                console.error('Ошибка в searchExternalInfo:', error);
                Lampa.Noty.show('Произошла ошибка при поиске информации');
            }
        }

        // --- Управление контроллером ---
        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) return;
            Lampa.Controller.add("content", {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(lastFocusedElement || false, scroll.render());
                },
                left: function () {
                    if (Navigator.canmove("left")) Navigator.move("left");
                    else Lampa.Controller.toggle("menu");
                },
                right: function () {
                    Navigator.move("right");
                },
                up: function () {
                    if (Navigator.canmove("up")) Navigator.move("up");
                    else Lampa.Controller.toggle("head");
                },
                down: function () {
                    if (Navigator.canmove("down")) Navigator.move("down");
                },
                back: this.back
            });
            Lampa.Controller.toggle("content");
        };

        this.pause = function () {};
        this.stop = function () {};
        this.render = function (js) {
            return js ? html : $(html);
        };
        this.destroy = function () {
            network.clear();
            Lampa.Arrays.destroy(items);
            scroll.destroy();
            html.remove();
        };
    }

    // --- Компонент для расширения информации в карточке ---
    function FullInfoComponent() {
        Lampa.Listener.follow("full", async (e) => {
            if (e.type === "complite") {
                try {
                    // 1. Получаем MAL ID из TMDB ID
                    const getMALResponse = await $.ajax({
                        url: `${ARM_API_URL}/themoviedb?id=${e.object.id}`,
                        method: "GET",
                        timeout: 10000
                    });

                    if (!getMALResponse || !getMALResponse.length) {
                        console.warn(`Данные для TMDB ID ${e.object.id} не найдены в ARM.`);
                        return; // Выходим, если не нашли связь
                    }

                    const malId = getMALResponse[0].myanimelist;

                    // 2. Получаем детали из Shikimori
                    const shikimoriData = await ShikimoriAPI.fetchAnimeDetails(malId);

                    // 3. Добавляем информацию на страницу
                    const cardElement = e.object.activity.render();
                    const rightPanel = cardElement.find(".full-descr__right");

                    if (shikimoriData.fandubbers && Array.isArray(shikimoriData.fandubbers) && shikimoriData.fandubbers.length > 0) {
                        const dubbersHtml = `
                            <div class="full-descr__info">
                                <div class="full-descr__info-name">Фандабберы</div>
                                <div class="full-descr__text">${shikimoriData.fandubbers.join(', ')}</div>
                            </div>`;
                        rightPanel.append(dubbersHtml);
                    }

                    if (shikimoriData.fansubbers && Array.isArray(shikimoriData.fansubbers) && shikimoriData.fansubbers.length > 0) {
                        const subbersHtml = `
                            <div class="full-descr__info">
                                <div class="full-descr__info-name">Фансабберы</div>
                                <div class="full-descr__text">${shikimoriData.fansubbers.join(', ')}</div>
                            </div>`;
                        rightPanel.append(subbersHtml);
                    }

                    // Добавляем рейтинг Shikimori
                    const shikimoriRateHtml = `<div class="full-start__rate rate--shikimori"><div>${shikimoriData.score}</div><div>Shikimori</div></div>`;
                    cardElement.find(".full-start-new__rate-line").prepend(shikimoriRateHtml);

                } catch (error) {
                    console.error("Ошибка при получении данных Shikimori для карточки:", error);
                    // Опционально: показать пользователю сообщение об ошибке
                    // Lampa.Noty.show('Ошибка загрузки данных Shikimori');
                }
            }
        });
    }

    // --- Функции генерации фильтров ---
    function generateSeasonJSON() {
        const seasonsOrder = ['winter', 'spring', 'summer', 'fall'];
        const seasonTranslations = { 'winter': 'Зима', 'spring': 'Весна', 'summer': 'Лето', 'fall': 'Осень' };
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth(); // 0-11

        let currentSeasonIndex, currentSeasonYear = currentYear;
        if (currentMonth >= 0 && currentMonth <= 1 || currentMonth === 11) {
            currentSeasonIndex = 0; // winter
            if (currentMonth === 11) currentSeasonYear = currentYear + 1;
        } else if (currentMonth >= 2 && currentMonth <= 4) {
            currentSeasonIndex = 1; // spring
        } else if (currentMonth >= 5 && currentMonth <= 7) {
            currentSeasonIndex = 2; // summer
        } else if (currentMonth >= 8 && currentMonth <= 10) {
            currentSeasonIndex = 3; // fall
        }

        const currentSeason = seasonsOrder[currentSeasonIndex];
        const prevSeasonIndex = (currentSeasonIndex - 1 + 4) % 4;
        let prevSeasonYear = currentYear;
        if (currentSeasonIndex === 0 && currentMonth !== 11) {
            prevSeasonYear = currentYear - 1;
        } else if (currentSeasonIndex === 0 && currentMonth === 11) {
            prevSeasonYear = currentYear;
        }
        const prevSeason = seasonsOrder[prevSeasonIndex];

        const dynamicSeasons = [
            { code: `${currentSeason}_${currentSeasonYear}`, title: `${seasonTranslations[currentSeason]} ${currentSeasonYear}` },
            { code: `${prevSeason}_${prevSeasonYear}`, title: `${seasonTranslations[prevSeason]} ${prevSeasonYear}` }
        ];

        const yearRanges = [];
        for (let year = currentYear; year >= currentYear - 4; year--) {
            yearRanges.push({ code: `${year}`, title: `${year} год` });
        }
        for (let startYear = currentYear; startYear >= currentYear - 20; startYear -= 5) {
            const endYear = startYear - 4;
            if (endYear <= startYear) {
                yearRanges.push({ code: `${endYear}_${startYear}`, title: `${endYear}–${startYear}` });
            }
        }

        return [...dynamicSeasons, ...yearRanges];
    }

    // --- Инициализация плагина ---
    function initializePlugin() {
        if (window.plugin_shikimori_ready) return;
        window.plugin_shikimori_ready = true;

        const manifest = {
            type: "other",
            version: "1.0",
            name: "LKE Shikimori",
            description: "Добавляет каталог Shikimori",
            component: SHIKI_PLUGIN_NAME
        };

        Lampa.Manifest.plugins = manifest;

        // Шаблоны и стили
        Lampa.Template.add('ShikimoriStyle', `
            <style>
                .Shikimori-catalog--list.category-full { justify-content: space-between !important; }
                .Shikimori-head.torrent-filter { margin-left: 1.5em; }
                .Shikimori.card__type { background: #ff4242; color: #fff; }
                .Shikimori .card__season { position: absolute; left: -0.8em; top: 3.4em; padding: 0.4em; background: #05f; color: #fff; font-size: 0.8em; border-radius: 0.3em; }
                .Shikimori .card__status { position: absolute; left: -0.8em; bottom: 1em; padding: 0.4em; background: #ffe216; color: #000; font-size: 0.8em; border-radius: 0.3em; }
                .Shikimori.card__season.no-season { display: none; }
            </style>`
        );

        Lampa.Template.add("Shikimori-Card", `
            <div class="Shikimori card selector layer--visible layer--render">
                <div class="Shikimori card__view">
                    <img src="{img}" class="Shikimori card__img" />
                    <div class="Shikimori card__type">{type}</div>
                    <div class="Shikimori card__vote">{rate}</div>
                    <div class="Shikimori card__season">{season}</div>
                    <div class="Shikimori card__status">{status}</div>
                </div>
                <div class="Shikimori card__title">{title}</div>
            </div>`
        );

        Lampa.Component.add(manifest.component, ShikimoriComponent);
        FullInfoComponent(); // Инициализируем компонент для полной информации

        $('body').append(Lampa.Template.get('ShikimoriStyle', {}, true));

        const button = $(`
            <li class="menu__item selector">
                <div class="menu__ico">
                    <svg fill="#FF0000" viewBox="0 0 24 24" role="img" xmlns="http://www.w3.org/2000/svg">
                        <title>Shikimori icon</title>
                        <path d="M2.8025.0025C2.7779.03 2.8332.1223 2.9834.3c.0981.1134.1594.2328.233.4444.0551.1594.1198.3157.1443.3464.0368.049.0396.037.0427-.1102V.8181l.218.3004c.331.4568.5365.6992.6744.7973.0706.046.1136.0919.0952.098-.049.0153-.4785-.2208-.6778-.374-.1012-.0767-.196-.1411-.2114-.1411-.0153 0-.0644-.0461-.1073-.1013-.0399-.0552-.1348-.1408-.2053-.1898-.1717-.1196-.3527-.2913-.3957-.374C2.763.7721 2.668.7323 2.668.7814c0 .049.245.377.435.5793.5825.6224 1.1776.932 2.7688 1.4287.3373.1043.6347.2085.6623.233.0246.0215.0737.0398.1074.0398.0306 0 .0795.0152.104.0305.0399.0245.0367.031-.0093.031-.0368 0-.0521.018-.046.0548.0092.0552.1595.1045.4477.1444.1287.0184.1593.0124.1593-.0244 0-.049-.0889-.083-.2207-.083-.049 0-.0858-.0151-.0858-.0304 0-.0184.031-.025.0708-.0188.0368.0092.1652.0306.2817.052.276.046.353.0768.353.135 0 .0644.0826.092.1377.046.0307-.0276.046-.0274.046-.0028 0 .0183.0151.0337.0304.0337.0184 0 .031-.0214.031-.046 0-.0582-.0309-.0586.4842.0212.3066.046.42.077.374.0923-.098.0368-.0428.0858.0952.0858.0705 0 .1195.0153.1195.0337 0 .0276.0704.0306.2452.0183.1594-.0123.2516-.0093.2639.0122.0122.0184.0643.0275.1195.0183.0521-.0092.1961.0034.3126.0248.3066.0583 1.1313.1044 2.977.1688 2.983.1042 5.157.3277 5.9726.6159.3617.1287.9075.4048 1.0087.509.1594.1686.2082.3066.1898.5334-.0092.1135-.0092.2149 0 .2241.089.089.2855-.0859.2855-.2545 0-.0338.0639-.1165.1467-.187.331-.2913.3803-.454.3436-1.1194-.0246-.4476-.031-.4782-.2302-1.1343-.2606-.8585-.3215-.9903-.6342-1.3214-.3679-.3863-.7023-.6072-1.1592-.7635-.1103-.0368-.3434-.1224-.5212-.1899-.2483-.098-.4262-.141-.788-.1931-.512-.0736-1.6126-.1256-1.956-.0919-.1226.0123-.6132 0-1.1498-.0337-.61-.0337-.984-.046-1.0729-.0277-.0766.0154-.2085.0274-.2944.0305-.1257 0-.1837.0187-.291.0984-.1257.092-.2149.1194-.5644.1777-.5641.092-.929.1653-1.0823.2175-.1196.0429-.3157.0706-.6192.089-.8309.0521-1.3029.0952-1.4071.129-.0706.0214-.3406.0274-.7913.0182-.5488-.0123-.6895-.006-.7171.0277-.0276.0306-.0155.0398.0581.0398.1809 0 1.7968.1258 1.8121.141.0154.0154-.273.003-1.0977-.0491-.2423-.0154-.4567-.0186-.472-.0094-.0583.0368-.4939.0307-.9108-.0122-.515-.0521-1.0115-.138-1.4714-.2545-.2146-.0521-.4662-.0916-.644-.1008-.328-.0153-.6778-.129-1.1714-.3773-.325-.1625-.3614-.1684-.3614-.0366v.1008L3.244.5331c-.0552-.0644-.1224-.1689-.15-.2302-.0552-.1165-.2609-.328-.2915-.3004zm.4584 3.1887c-.5697.0269-1.0938.4707-1.47 1.2628-.2238.4752-.2635.6593-.2789 1.291-.0122.4966-.0063.598.0642 1.0119.1503.8615.19.9625.5058 1.2721.3342.3312 1.1654.785 1.6284.8892.1594.0338.3464.0768.4139.0952.2575.0644.61.0885 1.4868.1008.8431.0153.9136.0125 1.027-.0427.0797-.0398.2486-.0707.4908-.089.2023-.0184.4165-.0459.4748-.0643.0582-.0153.1841-.0309.2087-.0309.0951 0 .1903-.0182.2087-.0366.0735-.0735.4228-.1503.757-.1687.187-.0092.3621-.0273.3928-.0427.1011-.0551.052-.0859-.1135-.0675-.095.0092-.187.003-.2207-.0154-.0491-.0307-.034-.0335.0825-.0366.0766 0 .2269-.0093.3342-.0216.1655-.0153.1842-.0248.1382-.0585-.1134-.0828-.0153-.1041.4936-.1041.4568 0 .5886-.0215.4537-.0736-.0275-.0092-.1413-.0216-.2517-.0216-.1134-.003-.1624-.0119-.1134-.015.0521-.006.1628-.0277.2517-.043.0859-.0185.6255-.0399 1.1958-.046.5702-.0061 1.0542-.0124 1.0757-.0155.0276 0 .0338-.0215.0216-.0614-.0123-.043-.0061-.061.0276-.061.0245 0 .083-.049.129-.1073.0919-.1195.1161-.1137.156.0427l.0277.1012.2207.0094c.1748.0061.2333-.003.2916-.046.0398-.0306.1224-.0645.1837-.0768l.1135-.0216-.0183.1782c-.0184.144-.0152.1716.0215.1593.0246-.0092.1222-.0338.2203-.0553l.1749-.0337-.0675-.089c-.043-.0491-.1226-.098-.1931-.1163l-.1224-.031.1838-.006a4.812 4.812 0 0 1 .3004 0c.0644.003.1135-.0089.1135-.0272 0-.0184-.0182-.034-.0366-.037-.0215-.0031-.089-.0064-.1472-.0095-.0582-.006-.1564-.0398-.2147-.0735-.0582-.0368-.1317-.067-.1593-.067-.0307 0-.0553-.0157-.0553-.031 0-.0215.092-.0305.2545-.0244.2483.0092.2514.0091.2606.0919.0123.095.0122.095.0797.0675a.0498.0498 0 0 0 .0305-.0581c-.0184-.049.037-.0893.083-.0586.0183.0092.0918.0215.1593.0276.1655.0092.9718.0737 1.1803.0952.1103.0122.1593.0307.1593.0614 0 .0521.037.0549.083.0089.0245-.0245.1442-.021.4354.0066.3557.0337.4017.0425.4017.0946 0 .0368.0213.0556.0704.0586.0368 0 .1656.0121.2821.0244.1196.0123.2329.0181.2513.009.0214-.0062.0891-.0979.1504-.2021.1196-.1993.2208-.3253.2607-.3253.0153 0 .018.0219.0089.0464-.0123.0245-.003.046.0154.046.0215 0 .0338.0244.0277.052-.0061.0367.0213.0582.0919.0735.1134.0246.1657.0582.089.0582-.0276 0-.0525.0183-.0525.0398 0 .0215.1812.0984.4448.1842.2821.095.4444.1623.4444.1899 0 .0306-.095.0092-.3586-.0797-.6254-.2146-.898-.2606-.898-.1533 0 .046.0488.0676.285.1228.1532.0368.3002.0642.3248.0642.0214 0 .0798.0338.1289.0736.049.043.294.144.5638.233.273.092.5153.19.5644.233.049.0398.1349.0952.1931.1166.1932.0828.4693.3309.6778.6099.3005.4047.2973.3895.1317.3895-.0766 0-.2946-.0214-.4847-.046-.19-.0245-.429-.0461-.53-.0492-.2147-.0061-1.9684.0278-2.6245.0493l-.4449.0154-.0703-.1504c-.0398-.0828-.1533-.2298-.2545-.331-.1747-.1717-.1837-.175-.2236-.1167-.0245.0337-.1168.1626-.2057.2822l-.1622.2236-.1992.0065c-.1104 0-.2242.0031-.2517 0-.0675-.006-.0703.0305-.009.144l.0427.0857-.3126.0216c-.8524.0582-2.661.282-3.268.4078-.135.0276-.4203.049-.6778.052-.46.0061-.5028.0184-.794.187-.0522.0276-.0922.0339-.129.0155-.0337-.0215-.0643-.0154-.0858.0122-.0337.0398-.144.058-.9534.1439-.1778.0184-.475.0584-.665.089-.3312.0552-.3499.0552-.5246 0-.184-.0582-.7572-.135-1.2478-.1687l-.276-.0216-.1622.1472c-.092.0797-.218.2177-.2855.3066-.092.1257-.141.166-.1992.166-.1257 0-1.2448.1743-2.0573.3215-.8768.1594-1.2077.1904-1.4652.1382-.2668-.0551-.2701-.0583-.2578-.3956.0122-.2851.0093-.2941-.0643-.3309-.1686-.0858-.331-.0371-.5517.1622-.052.046-.1133.0675-.1992.0675-.0705-.003-.1993.0306-.3004.0797l-.181.083.009.1593c.006.0858-.0032.1868-.0216.2175-.0245.0368-.0306.1994-.0183.4692.0123.328.003.4476-.0398.607l-.052.1964.1471.2086c.2943.4139.503.7294.503.763 0 .0185.0916.1169.208.218.506.4446.7207.5642 1.2174.6685.5273.1134.6131.1072.9412-.0675.1502-.0828.3251-.1965.3895-.2578.0797-.0736.3067-.1931.742-.3863.6776-.3004.7631-.3342.7631-.2943 0 .0122.043.426.0952.9135.1073 1.024.1411 2.0052.0951 2.7595-.0368.5917-.0644.6743-.4814 1.4591-.6469 1.2172-1.4224 2.3947-2.008 3.0477-.1043.1196-.2636.325-.3525.4599-.1686.2544-.4815.595-.871.9445-.1317.1195-.2177.2206-.2085.2451.0092.0245.1046.0734.2119.1102.1042.0398.2052.083.2236.0984.049.049.1101.0303.337-.0924l.2207-.1223.0891.0614c.1073.0705.3006.0763.4631.015.0644-.0245.1932-.052.2883-.0581.19-.0184.3126-.0703.5118-.2236.0736-.0552.1687-.1073.2147-.1195.089-.0184.8585-.7976 1.2694-1.2881.1287-.1502.4506-.4905.7204-.7542.3771-.374.5457-.5148.7603-.6436.3096-.184.5548-.4076.5854-.5395.0123-.046.052-.1413.0919-.2118.095-.1625.2024-.5792.1748-.6835-.0092-.0429-.0552-.147-.1012-.233-.0797-.141-.0855-.1901-.1008-.5826-.0276-.6898-.138-1.0515-.4875-1.5941-.2023-.3127-.2516-.4231-.3773-.8278-.2085-.696-.2697-1.3493-.1655-1.8613.049-.2545.0735-.2883.279-.4078.1072-.0644.2484-.1656.3159-.227l.1256-.1162.5948-.0675c.328-.0398.6958-.0889.8123-.1134.1196-.0245.3831-.0797.5855-.1195.2054-.043.497-.1164.6473-.1655.1502-.0521.3616-.1137.472-.1383.2146-.049.9472-.1192.9717-.0946.0092.0092.0185.4476.0155.975 0 .8277-.0092 1.0515-.0797 1.6616-.1196 1.0455-.1442 1.3732-.1749 2.526-.0276 1.1466-.0365 1.1986-.2236 1.3335-.1349.0981-.2728.0802-.6806-.1007-.2023-.089-.6286-.264-.9505-.3928-.3189-.1288-.7727-.3277-1.0027-.4411-.233-.1165-.4232-.2028-.4232-.1936 0 .0092.1165.1595.2606.3342.144.1748.2606.325.2606.3342 0 .0092-.0274.0188-.0642.0188-.0552 0-.0584.006-.0155.0642.0276.0398.0369.101.0277.1654-.0123.0828-.0032.1106.058.1505.04.0276.1046.1041.1445.1716.0368.0643.1012.147.141.1776.04.0307.098.1044.1318.1627.0306.0582.1348.1654.233.239.098.0736.193.1687.2113.2086.0184.046.1077.1133.2119.1655.2422.1226.5975.4353.6557.5732.0338.0859.1015.1534.2977.2822.1564.1042.4321.3433.7387.6469.558.5518.5887.5703 1.0425.5427.2943-.0214.4416-.0768.6164-.2362.0705-.0644.1563-.1316.187-.15.0306-.0184.1072-.1072.1655-.1992.0582-.095.147-.1932.193-.2208.1288-.0766.3587-.402.3587-.5062 0-.1533.0582-.251.2606-.441.1778-.1656.2149-.2213.3253-.4941.1717-.417.2326-.6864.2878-1.223.0674-.6622.0616-1.4623-.015-1.962-.1257-.8156-.604-3.0876-.7481-3.5414-.1196-.377-.233-.8676-.233-1.0087 0-.0337.064-.0369.3155-.0215.23.0153.4108.0094.6745-.0305.3127-.046.4202-.049.7514-.0183.2115.0184.3923.0396.3984.0488.0245.0214.4968 1.5575.5765 1.8702.1656.6408.1688.687.2025 2.2996.0153.8431.0304 1.8426.0366 2.2228.0061.6407.0124.7111.089.9932.0981.3587.2054.5919.4261.9108.089.1257.2238.3464.3005.4874.1533.2852.3527.521.6103.7172.3372.2606.6652.4724.8676.5644.2422.1103.4382.2849.6314.5577.0797.1104.1932.2609.2545.3375.0613.0767.1378.1932.1716.2607.0582.1226.0766.1348.4078.233.1532.0459.5762.0548.8123.015.1318-.0216.1812-.052.3928-.2574.285-.276.42-.469.42-.607 0-.2146.0303-.279.156-.3281.0798-.0307.1196-.0673.1196-.1041 0-.1932-.2023-.9723-.3066-1.1747-.0674-.1349-.9471-1.324-1.686-2.2836-.7849-1.0148-1.061-1.4567-1.2234-1.935-.0521-.1624-.2481-1.2754-.3708-2.143-.0889-.6224-.2608-1.2386-.5306-1.9223-.092-.233-.1564-.4228-.141-.4228.0735 0 1.6526.4415 1.7445.4875.0583.0307.2974.159.5274.2878.23.1318.4537.2363.4935.2363.046 0 .239.1073.466.2606l.3895.2606.2025-.0155c.2912-.0276.346-.0398.4687-.1256.1748-.1196.2792-.138.4172-.0736.2667.1257.4507.1472.2883.0338-.2422-.1687-.2667-.2516-.1257-.4632.1687-.2575.1867-.2757.3614-.3646.279-.141.2976-.1745.3895-.6774.043-.2452.1011-.4848.1257-.5338.0705-.1472.0553-.2419-.0642-.3553-.0614-.0583-.1627-.1904-.2302-.2916-.095-.1472-.1223-.2175-.1223-.3248 0-.1196-.0124-.144-.1013-.1992a1.3114 1.3114 0 0 0-.218-.1074c-.1318-.046-.3369-.2635-.3093-.3248a2.3155 2.3155 0 0 0 .0337-.083c.0246-.0613-.2239-.1962-.4692-.2545-.2452-.0582-.2421-.0583-.1992-.1073.0215-.0276.0212-.1227.0028-.3005-.092-.84-.4321-1.4285-.9993-1.7259-.1226-.0644-.2299-.1288-.239-.1471-.0583-.089-.7818-.365-1.1803-.4477-.1257-.0245-.3744-.0857-.5522-.1378-.1778-.049-.4504-.1016-.6098-.12-.4568-.043-1.073-.147-1.2754-.2114-.1012-.0307-.3403-.0858-.5335-.1195-.1931-.0368-.3587-.0766-.368-.0919-.0122-.0184-.0858-.0156-.187.0028-.1164.0215-.2912.0217-.5671-.0028-.2177-.0215-.7573-.034-1.1957-.031-.6745.0031-.8585-.0057-1.2019-.0609-.2207-.0368-.518-.0646-.659-.0646-.3373-.0031-1.331-.1042-1.1531-.1196.0276 0 .1195-.0181.2053-.0365.141-.0307.1504-.0372.1228-.0985-.0306-.0644-.0458-.0673-.478-.0642-.368 0-.4539.0094-.4815.0492-.0306.0399-.0615.0428-.1964.0183-.144-.0306-.1533-.0368-.1073-.0736.049-.0368.0492-.046.0094-.0736-.0246-.0153-.0676-.031-.0952-.031-.0399 0-1.9562-.19-2.7533-.2727-.1564-.0184-.2941-.0365-.3033-.0488-.0092-.0092.0061-.0154.0337-.0154.0307 0 .052-.0124.052-.0277 0-.046-.156-.058-.3707-.0244-.1502.0215-.2303.0213-.2794-.0032-.0582-.0246-.0395-.0273.0924-.015.2912.0306.1683-.0401-.1383-.077-.1656-.0214-.3372-.043-.3801-.0491a.486.486 0 0 1-.1379-.046c-.0306-.0184-.3679-.0763-.748-.1284-.3802-.0521-.8065-.1291-.9506-.172-.4967-.141-.9532-.371-1.2169-.607l-.1382-.1224.0492-.1167c.1011-.2422.2299-.3832.4598-.4936.3158-.1533.46-.178 1.0762-.1964.561-.0122.693-.0365.6286-.1101-.0307-.043-.472-.1106-.6928-.1106-.138 0-.4815-.0674-.7973-.1594a1.2257 1.2257 0 0 0-.4003-.0488zm8.8497 2.9503a.3051.3051 0 0 0-.0675.0051c-.181.0307-.285.0734-.3769.15l-.0919.0736.1472.0033c.1564 0 .239-.0306.3525-.1317.0713-.0644.0838-.0963.0366-.1003zm5.7762.951c.0383-.0023.0814.0089.1626.0319.092.0276.193.0401.2236.031.0307-.0093.0674-.0033.0797.0182.0153.0276-.0305.0308-.1838.0155-.1349-.0154-.2025-.0126-.2025.0089 0 .0184.0368.04.0858.0492.2238.049.2607.0737.0675.0553-.1103-.0123-.276-.0213-.368-.0244-.1594 0-.1684.003-.1776.0797-.0092.0705-.0307.0856-.181.1163-.2053.0398-.1775.0428-.3308-.0277-.138-.0674-.4418-.141-.819-.1992-.141-.0215-.2112-.0396-.1621-.0427.0521 0 .3342.0307.6286.0736.5457.0767.6988.0919.6651.0582-.0092-.0092-.2483-.0644-.5334-.1196l-.5151-.1012.3004-.0033c.2637-.003.3098.0064.3895.0647.0675.049.1011.0583.1256.0337.0215-.0214.1133-.028.2574-.0187.1931.0153.2452.0095.3525-.0488.0628-.0322.0966-.0483.135-.0506zm-4.3466.5128c.0152-.0005.0284.0022.036.0099.0124.0092.0002.0306-.0243.0459-.0582.0368-.0828.037-.1073.0033-.0138-.0253.0499-.0575.0956-.059zm4.9869.09c.0057-.002.0158.0105.0342.0366.0214.0276.0673.052.098.052.049 0 .0524.006.0126.0305-.0245.0153-.0522.0276-.0614.0276-.0613-.0061-.0919-.0428-.0919-.098.0015-.0306.0027-.0468.0085-.0487zm-3.9515.1805c-.0613 0-.104.052-.104.1256 0 .0153.0702.0276.156.0276.1472 0 .1536-.003.1168-.052-.0613-.0797-.0983-.1012-.1688-.1012zm6.1901 1.8304c.0215-.0092.0738.012.1167.0426.0675.0521.0674.0584.0122.0553-.0858 0-.184-.0765-.1289-.098Z"/>
                    </svg>
                </div>
                <div class="menu__text">Shikimori</div>
            </li>`);

        button.on("hover:enter", () => {
            Lampa.Activity.push({
                url: '',
                title: 'Shikimori',
                component: SHIKI_PLUGIN_NAME,
                page: 1
            });
        });

        $(".menu .menu__list").eq(0).append(button);
    }

    // Запуск плагина
    if (!window.plugin_shikimori_ready) {
        initializePlugin();
    }
})();
