# POTRAZ Innovation Expo 2026 — Photo Gallery

A static gallery for the Expo 2026 (Bulawayo) photos: browse by day, view full size,
and multi-select photos to download as a single zip.

## Adding photos

Drop new images into a folder under `EXPO 2026 Byo/`, then regenerate thumbnails and the manifest:

```bash
npm install
npm run build
```

## Running locally

Zip downloads use `fetch`, so serve the folder over HTTP rather than opening `index.html` directly:

```bash
npm run serve
```

Then open http://localhost:8080. The site is fully static and can be hosted on GitHub Pages.

## Web services

Want a site like this? Email **nqobilemuyambiri@gmail.com**.
