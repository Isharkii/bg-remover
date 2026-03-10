# Photo Forge Editor (React Frontend)

This frontend adds a full photo editing UI to your background remover project.

## Features

- Upload photo (replace canvas)
- Add extra image layers
- Drag and drop image upload
- Clipboard paste (`Ctrl/Cmd + V` or Paste button)
- Move, scale, rotate, flip, duplicate, reorder, delete objects
- Draw mode + eraser mode
- Add shapes (rectangle, circle, triangle, line)
- Add editable text
- Rectangle crop
- Polygon pen crop
- Basic image filters (brightness, contrast, saturation, blur)
- In-browser background removal HQ (API-like edge refinement; works on GitHub Pages + phone browser)
- Browser quality profiles: `Detail Preserving` and `Clean Edges`
- Optional "Remove BG via API" (POST image file to your backend endpoint)
- Undo / Redo history
- Download as PNG or JPEG

## Run

```bash
cd frontend-react
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal (usually `http://localhost:5173`).

## Run Background API

From repo root:

```bash
pip install -r requirements-api.txt
uvicorn api_server:app --host 0.0.0.0 --port 8000 --reload
```

In the UI, set endpoint to:
`http://localhost:8000/remove-background`

You only need this API mode if you do not want browser-side removal.

## GitHub Pages

This repo includes a workflow at `.github/workflows/deploy-pages.yml` that deploys `frontend-react/dist` on pushes to `main`.

1. Push your latest commit to `main`.
2. In GitHub repo settings, open **Pages**.
3. Set **Source** to **GitHub Actions**.
4. Wait for the **Deploy Frontend To GitHub Pages** workflow to finish.

Your app URL should be:
`https://isharkii.github.io/bg-remover/`

When opened from that URL (including phone browser), use `Remove BG (Browser HQ)` for fully online usage without localhost.

## Notes

- The editor runs fully in-browser on an HTML canvas.
- PNG export preserves transparency for erased/cropped regions.
- `Remove BG (Browser HQ)` works without any backend and is suitable for GitHub Pages.
- Browser HQ mode is slower on first run because model files are downloaded and cached.
- For fine hair/details, keep profile on `Detail Preserving`.
- For `Remove BG via API`, use a reachable endpoint (public HTTPS endpoint for hosted pages).
