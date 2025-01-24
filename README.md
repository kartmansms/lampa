# Lampa Kartman Edition (LKE)


[Shikimori](https://kartmansms.github.io/lampa/Shikimori.js)

[Shikimori](https://kartmansms.github.io/lampa/Shikimori/Shikimori.js)


Ссылка на подключение плагина в Lampa https://kartmansms.github.io/lampa/Shikimori.js

Прямая ссылка на подключение плагина в Lampa

const linkToCopy = [LKE](https://kartmansms.github.io/lampa/Shikimori.js)
function Copy() {
  var Url = document.getElementById("url");
  Url.innerHTML = window.location.href;
  console.log(Url.innerHTML)
  Url.select();
  document.execCommand("copy");
}
<div>
  <input type="button" value="Copy Url" onclick="Copy();" />
  <br /> Paste: <textarea id="url" rows="1" cols="30"></textarea>
</div>
