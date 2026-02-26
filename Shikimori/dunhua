(function () {
    'use strict';

    var plugin = {
        name: 'Dunhua Bilibili',
        version: '1.0',
        description: 'Плагин для поиска и просмотра дунхуа с Bilibili',
        author: 'Your Name',
        url: 'your-plugin-url.js', // Для само-регистрации

        init: function () {
            // Добавляем в меню Lampa
            Lampa.Menu.add({
                id: 'dunhua',
                title: 'Дунхуа Bilibili',
                icon: '🎎',
                onSelect: this.showPopular.bind(this)
            });
        },

        showPopular: function () {
            // Загружаем популярные дунхуа (используем keyword для donghua)
            this.fetchData({ keyword: 'donghua popular', order: 'pubdate', page: 1 }, (results) => {
                this.displayCards(results);
            });
        },

        fetchData: function (params, callback) {
            // Пример использования Bilibili API (нужно импортировать или использовать прямой fetch)
            var url = 'https://api.bilibili.com/x/web-interface/search/type?jsonp=jsonp&search_type=video&keyword=' + encodeURIComponent(params.keyword) + '&order=' + params.order + '&page=' + params.page + '&duration=0&type=1'; // Адаптируй под реальный эндпоинт
            fetch(url)
                .then(response => response.json())
                .then(data => {
                    // Парсим результаты: data.result может содержать видео
                    var items = data.result.map(item => ({
                        title: item.title,
                        poster: item.pic,
                        description: item.desc,
                        url: 'https://www.bilibili.com/video/' + item.bvid // Для просмотра
                    }));
                    callback(items);
                })
                .catch(error => console.error('Error fetching Bilibili:', error));
        },

        displayCards: function (items) {
            // Интегрируем в UI Lampa как карточки
            Lampa.Controller.show({
                title: 'Популярные Дунхуа',
                items: items.map(item => Lampa.Card(item)),
                tabs: [{ title: 'Фильтры', onSelect: this.showFilters.bind(this) }]
            });
        },

        showFilters: function () {
            // Вкладка с фильтрами: год, рейтинг и т.д.
            // Здесь можно добавить UI для ввода параметров и повторный fetch
            // Например, params.year = '2023', но Bilibili API может требовать адаптации
        }
    };

    Lampa.Plugin.register(plugin);
})();
