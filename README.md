<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1i92dDHEBcqxwnJiWQNRS5qB0tTFm5iUZ

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Configure environment:
   - Frontend: set `GEMINI_API_KEY` and `VITE_API_URL` in `.env.local`
   - Backend: copy `.env.example` to `.env` and set `DATABASE_URL` and `APP_URL`
   - Supabase Auth (magic link): set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`
   - Optional fallback email sender: set `RESEND_API_KEY` and `RESEND_FROM` (used by legacy `/api/auth/request-magic` path)
   - Optional: configure S3/R2 storage by setting `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, `S3_KEY_PREFIX`, and `S3_SIGNED_URL_TTL`
3. Start Postgres (Docker):
   - `docker compose up -d`
   - `psql postgres://tap:tap@localhost:5432/tap -f server/schema.sql`
4. Run the API:
   `npm run dev:api`
5. Run the app:
   `npm run dev`

Notes:
- If `RESEND_API_KEY`/`RESEND_FROM` are not set in dev, the legacy backend magic-link endpoint logs the link to the console.
- For S3/R2 direct uploads and signed GETs, configure bucket CORS to allow `PUT`, `GET`, and `HEAD` from your app origin.
- Keep the bucket private; the app uses signed GET URLs for protected playback and artwork.

## Supabase Email Auth Setup

1. In Supabase Dashboard, open `Auth -> Providers -> Email`.
2. Enable either:
   - `Supabase Email` (built-in sender), or
   - `Custom SMTP` (recommended for production domains).
3. In `Auth -> URL Configuration`:
   - Set `SITE_URL` to your app origin (example local: `http://localhost:5173`, production: `https://your-domain.com`).
   - Add redirect URLs for every origin that can receive magic links, for example:
     - `http://localhost:5173/*`
     - `http://localhost:3000/*`
     - `https://your-domain.com/*`
4. Run the API and open `GET /api/auth/config` to verify the app's expected `siteUrl` and `redirectUrls`.
5. Test locally:
   - Request magic link from a public album page.
   - Click the email link and confirm you return to the album URL.
   - Verify the session persists after refresh and PIN issuance works.

## Temporary Production Project Health Debug Endpoint

- Set `DEBUG_TOKEN` in production.
- Call `GET /api/health/projects` with header `X-Debug-Token: <DEBUG_TOKEN>`.
- Response includes:
  - `ghostCount`
  - `total`
  - `sampleIds`
  - `expiresAt`
- Availability:
  - Production only.
  - Enabled for 24 hours after server start.
