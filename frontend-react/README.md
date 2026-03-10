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

## Notes

- The editor runs fully in-browser on an HTML canvas.
- PNG export preserves transparency for erased/cropped regions.
- For `Remove BG via API`, point the endpoint field to your running backend route.
