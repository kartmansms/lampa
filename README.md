# Lampa Kartman Edition (LKE)


[Shikimori](https://kartmansms.github.io/lampa/Shikimori.js)

[Shikimori](https://kartmansms.github.io/lampa/Shikimori/Shikimori.js)

async function writeClipImg() {
  try {
    if (ClipboardItem.supports("image/svg+xml")) {
      const imgURL = "/my-image.svg";
      const data = await fetch(imgURL);
      const blob = await data.blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob,
        }),
      ]);
      console.log("Fetched image copied.");
    } else {
      console.log("SVG images are not supported by the clipboard.");
    }
  } catch (err) {
    console.error(err.name, err.message);
  }
}
