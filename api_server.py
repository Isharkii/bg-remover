from io import BytesIO

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from PIL import Image, UnidentifiedImageError

from remove_bg import DEFAULT_MODEL_NAME, create_session, remove_background_image

app = FastAPI(title="Background Remover API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load once and reuse for lower latency on repeated requests.
SESSION = create_session(DEFAULT_MODEL_NAME)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/remove-background")
async def remove_background_endpoint(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Upload must be an image file.")

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded image is empty.")

    try:
        source = Image.open(BytesIO(payload))
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=400, detail="Could not parse image file.") from exc

    try:
        result = remove_background_image(
            source,
            model_name=DEFAULT_MODEL_NAME,
            session=SESSION,
        )
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(
            status_code=500,
            content={"detail": f"Background removal failed: {exc}"},
        )

    output_buffer = BytesIO()
    result.save(output_buffer, format="PNG", compress_level=1)
    output_buffer.seek(0)

    return StreamingResponse(
        output_buffer,
        media_type="image/png",
        headers={"Content-Disposition": 'inline; filename="removed-background.png"'},
    )
