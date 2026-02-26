(function () {
    'use strict';

    // Полифилы из Shikimori (ownKeys, _objectSpread2, _regeneratorRuntime и т.д.) — оставляем для совместимости

    // Основная функция для fetching данных из Bilibili API
    function main(params, oncomplete, onerror) {
        $(document).ready(function () {
            var baseUrl = 'https://api.bilibili.com/x/web-interface/search/type';
            var queryParams = {
                jsonp: 'jsonp',
                search_type: 'video',
                keyword: params.keyword || 'donghua', // По умолчанию дунхуа
                tid: 33, // Категория аниме/дунхуа
                order: params.sort || 'pubdate', // Сортировка: pubdate, totalrank и т.д.
                page: params.page || 1,
                pagesize: 36 // Аналог limit в Shikimori
            };

            if (params.year) queryParams.keyword += ' ' + params.year; // Простая фильтрация по году через keyword
            // Добавь другие фильтры, если API поддерживает (например, duration для типа)

            var url = baseUrl + '?' + $.param(queryParams);

            $.ajax({
                url: url,
                method: 'GET',
                success: function (response) {
                    if (response.code === 0 && response.data && response.data.result) {
                        oncomplete(response.data.result); // Массив видео с title, pic, desc, bvid
                    } else {
                        onerror('No data');
                    }
                },
                error: function (error) {
                    console.error('Ошибка Bilibili:', error);
                    onerror(error);
                }
            });
        });
    }

    // Функция search — адаптировать под Bilibili, возможно, для детального просмотра видео
    function search(dunhuaData) {
        // Здесь можно fetch детальную инфу по bvid, или интегрировать с TMDB как в Shikimori
        // Например: https://api.bilibili.com/x/web-interface/view?bvid=...
    }

    // Класс Card — адаптировать поля под Bilibili (title, pic как poster, play для views как rate?)
    function Card(data, userLang) {
        // Локализация, форматирование
        var item = Lampa.Template.get("Dunhua-Card", {
            img: 'https:' + data.pic, // Poster
            type: data.typename || 'Дунхуа', // Тип
            rate: data.score || data.play, // Рейтинг или views
            title: data.title,
            season: data.pubtime ? new Date(data.pubtime * 1000).getFullYear() : '' // Год как сезон
        });
        // render и destroy как в Shikimori
    }

    // Компонент для каталога — аналогичный, с фильтрами (sort: pubdate/totalrank, years динамически)
    function Component$1(object) {
        // Scroll, html, head с "Главная" и "Фильтр"
        // Фильтры: sort (pubdate, totalrank), seasons (динамические годы как в Shikimori), возможно genres via отдельный AJAX к Bilibili API
        // build, body с карточками, etc.
    }

    // Добавление кнопки в меню с иконкой Bilibili
    function add() {
        // Аналогично, но с SVG для Bilibili
    }

    // startPlugin() с manifest {name: "Dunhua Bilibili", component: "DunhuaBilibili"}
    // Шаблоны: DunhuaStyle, Dunhua-Card

    if (!window.plugin_dunhua_ready) startPlugin();
})();
