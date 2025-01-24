# Lampa Kartman Edition (LKE)


[Shikimori](https://kartmansms.github.io/lampa/Shikimori.js)

[Shikimori](https://kartmansms.github.io/lampa/Shikimori/Shikimori.js)


Ссылка на подключение плагина в Lampa https://kartmansms.github.io/lampa/Shikimori.js

Прямая ссылка на подключение плагина в Lampa

<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Копирование ссылки</title>
</head>
<body>
    <p>Ссылка: <span id="link">https://kartmansms.github.io/lampa/Shikimori.js</span></p>
    <button id="copyButton">Скопировать ссылку</button>

    <script>
        document.getElementById('copyButton').addEventListener('click', function() {
            // Получаем ссылку
            const link = document.getElementById('link').textContent;

            // Используем современный Clipboard API для копирования
            navigator.clipboard.writeText(link).then(function() {
                alert('Ссылка скопирована: ' + link);
            }).catch(function(error) {
                console.error('Ошибка при копировании: ', error);
                alert('Не удалось скопировать ссылку.');
            });
        });
    </script>
</body>
</html>
