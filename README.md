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
    <p>Ссылка: <a id="link" href="https://example.com">https://example.com</a></p>
    <button id="copyButton">Скопировать ссылку</button>

    <script>
        document.getElementById('copyButton').addEventListener('click', function() {
            // Получаем ссылку
            const link = document.getElementById('link').href;

            // Создаем временный элемент textarea для копирования
            const tempTextArea = document.createElement('textarea');
            tempTextArea.value = link;
            document.body.appendChild(tempTextArea);

            // Выделяем текст в textarea
            tempTextArea.select();
            tempTextArea.setSelectionRange(0, 99999); // Для мобильных устройств

            // Копируем текст в буфер обмена
            document.execCommand('copy');

            // Удаляем временный элемент textarea
            document.body.removeChild(tempTextArea);

            // Опционально: уведомление пользователя
            alert('Ссылка скопирована: ' + link);
        });
    </script>
</body>
</html>
