# Firefly Notes

A meeting library and interactive transcript workspace inspired by Fireflies.ai.

## Stack

- `frontend/`: Next.js 14, TypeScript, plain CSS
- `backend/`: FastAPI, SQLAlchemy, SQLite

## Run locally

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

cd ../frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The API is at `http://localhost:8000` and seeds a usable meeting library on first start.

## Included workflows

- Meeting library with text, person, and date filtering plus recency sorting
- Meeting create, edit, delete, and persistent action-item workflows
- Paste or upload a `.txt` transcript when creating a meeting; each line becomes a timestamped speaker segment
- Interactive transcript search, highlighted matches, seek-on-click, and a synthesized voice playback preview with a seek bar
- AI notes, action items, key topics, and TXT/Markdown export
- Functional Soundbites, Analytics, Global search, and Settings views

`/docs` exposes the FastAPI endpoints while the backend is running.

## Architecture and schema

The UI reads and mutates a REST API. `meetings` have many `transcript_segments` and `action_items`; the meeting owns its generated summary and key topics. Transcript entries carry a speaker and a start/end offset, which lets the UI seek a local audio player when a row is selected. SQLite is used for a portable development database; change `DATABASE_URL` for deployment.

## Assumptions

Audio transcription and authentication are mocked. The player uses the browser's speech-synthesis API to provide an audible preview of the active transcript segment, while seeded summaries stand in for an LLM.

## Deployment

The repository includes `render.yaml` for the FastAPI service. In Render, create a Blueprint from the GitHub repository; its build command and start command are already defined. For a production application, replace SQLite with a managed database because Render's local disk is ephemeral.

Deploy `frontend/` as a Next.js project on Vercel. Add the following Vercel environment variable before deploying:

```text
NEXT_PUBLIC_API_URL=https://your-render-service.onrender.com
```

The backend's `CORS_ORIGINS` setting is `*` for this unauthenticated demo. Restrict it to the Vercel domain when adding authentication or sensitive data.
