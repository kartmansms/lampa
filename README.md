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
    <div id="container">
        <!-- Кнопка будет добавлена сюда -->
    </div>

    <script>
        // Определенная ссылка, которую нужно скопировать
        const linkToCopy = "https://kartmansms.github.io/lampa/Shikimori.js";

        // Создаем кнопку
        const copyButton = document.createElement('button');
        copyButton.textContent = 'Скопировать ссылку';
        copyButton.style.marginTop = '10px';
        copyButton.style.padding = '8px 16px';
        copyButton.style.backgroundColor = '#007BFF';
        copyButton.style.color = '#fff';
        copyButton.style.border = 'none';
        copyButton.style.borderRadius = '4px';
        copyButton.style.cursor = 'pointer';

        // Добавляем обработчик события для кнопки
        copyButton.addEventListener('click', function() {
            // Используем Clipboard API для копирования
            navigator.clipboard.writeText(linkToCopy).then(function() {
                alert('Ссылка скопирована: ' + linkToCopy);
            }).catch(function(error) {
                console.error('Ошибка при копировании: ', error);
                alert('Не удалось скопировать ссылку.');
            });
        });

        // Добавляем кнопку в контейнер
        document.getElementById('container').appendChild(copyButton);
    </script>
</body>
</html>
