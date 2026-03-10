# Background Remover Project

This repo contains:

- `remove_bg.py`: CLI background remover script
- `api_server.py`: FastAPI endpoint for frontend integration
- `frontend-react/`: React image editor UI

The frontend supports two background-removal modes:

- Browser mode: no backend required (works on GitHub Pages and phone browsers)
- API mode: uses `api_server.py` or another compatible endpoint

If you are using `https://isharkii.github.io/bg-remover/`, use browser mode.

## Run API Server (for "Remove BG via API")

```bash
pip install -r requirements-api.txt
uvicorn api_server:app --host 0.0.0.0 --port 8000 --reload
```

Health check:

```bash
curl http://localhost:8000/health
```

Main endpoint used by frontend:

- `POST http://localhost:8000/remove-background`
- Form field name: `file`
- Returns: `image/png`

## Run Frontend

```bash
cd frontend-react
npm install
npm run dev
```

For browser mode, no endpoint is required.

For API mode, set endpoint to:
`http://localhost:8000/remove-background`
