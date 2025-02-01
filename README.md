<div align="center">
  <img src="images/k.svg" width="60%" alt="https://kartmansms.github.io/lampa/" />
</div>
<hr>



<div align="center">
<h1>🚀 Lampa Kartman Edition (LKE)
</h1>
</div>

**Ссылка  на установку плагина**
```bibtex
 https://kartmansms.github.io/lampa/Shikimori/Shikimori.js
```



**За основу взят код:**  [LME Shikimori](https://lampame.github.io/main/Shikimori/Shikimori.js) `https://lampame.github.io/main/Shikimori/Shikimori.js`

**Переработал код** https://t.me/kartman_sms



Данный код представляет собой плагин для медиа-приложения Lampа, который добавляет интеграцию с каталогом аниме Shikimori. Ключевых функциях:

### 1. **Доступ к каталогу Shikimori**
- Запросы к GraphQL API Shikimori для получения данных об аниме с фильтрацией по параметрам: 
  - Тип (ТВ, фильм, OVA и т.д.)
  - Статус (анонс, онгоинг, завершено)
  - Жанры
  - Сезоны и годы выпуска
  - Сортировка по рейтингу, популярности, дате выхода.

### 2. **Интеграция с другими API**
- Поиск информации через MyAnimeList и TMDB для дополнения данных:
  - Автоматический переход к TMDB при отсутствии данных в MyAnimeList.
  - Обработка ошибок (например, 404) и альтернативные запросы.

### 3. **Пользовательский интерфейс**
- Отображение карточек аниме с:
  - Постерами
  - Рейтингом
  - Статусом (переведённым на русский)
  - Сезоном и годом выпуска
  - Локализованными названиями (русский, английский, японский).

### 4. **Фильтры и навигация**
- Динамические фильтры с поддержкой:
  - Выбора жанров
  - Сезонов (включая автоматическое определение текущего сезона)
  - Годовых диапазонов.
- Интуитивная навигация с поддержкой прокрутки и клавиатурного управления.

### 5. **Интеграция в приложение**
- Добавление кнопки в меню для быстрого доступа к каталогу.
- Совместимость с UI-библиотекой Lampa (шаблоны, стили, компоненты).

### 6. **Дополнительные функции**
- Отображение информации о фандабберах и фансабберах.
- Поддержка перевода терминов на русский язык.
- Адаптация под прокси-серверы для обхода ограничений.
