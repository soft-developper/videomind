# VideoMind — AI-First Video Intelligence Platform

✅ Built on Shelby Protocol · Powered by Claude + Whisper · Persisted on Turso

Turn every video into an AI-searchable knowledge base.

VideoMind is a wallet-native dapp built on Shelby Protocol (Aptos Testnet). Upload any video with your Aptos wallet — AI automatically generates transcripts, chapters, highlights, summaries, blog posts and X threads. Everything is stored on Shelby Protocol and searchable by meaning.

➡️Features

Wallet-native uploads — Petra wallet signs every Shelby blob transaction
Whisper transcription — Full timestamped transcript extracted automatically
Claude analysis — Chapters, highlights, summary, blog post, X thread
AI Chat — Ask any question about your video, get answers with timestamps
Semantic search — Search across your entire library by meaning
Wallet-scoped library — Each wallet sees only its own videos
Auto blob renewal — Cron daemon handles Shelby's 48hr expiry limit


✅ Setup

Prerequisites
Node.js v22+
[Petra Wallet](https://petra.app) browser extension
[Turso CLI](https://docs.turso.tech/cli/introduction)
Shelby Protocol early access (Testnet)

1. Clone

bash
git clone https://github.com/soft-developper/videomind.git
cd videomind

2. Create Turso database

bash
turso auth login
turso db create videomind
turso db show videomind url        # → TURSO_DATABASE_URL
turso db tokens create videomind     # → TURSO_AUTH_TOKEN

3. Configure environment

backend/.env(copy from .env)
.env
➡️Turso
TURSO_DATABASE_URL=libsql://videomind-yourname.turso.io
TURSO_AUTH_TOKEN=eyJ...

➡️Shelby / Aptos
APTOS_PRIVATE_KEY=ed25519-priv-0x...
APTOS_ACCOUNT_ADDRESS=0x...
APTOS_API_KEY=aptoslabs_...

➡️AI
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

PORT=4000
FRONTEND_URL=http://localhost:3000

frontend/.env.local(copy from `.env.local)
.env
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_APTOS_API_KEY=aptoslabs_...


4. Install & run

bash
# Terminal 1 — Backend
cd backend
npm install
npm run dev

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev
```

Open http://localhost:3000, connect your Petra wallet and upload a video.


## Shelby Integration

| Feature | Detail |
|---------|--------|
| SDK | `@shelby-protocol/sdk` (Node) + `@shelby-protocol/react` |
| Hook | `useUploadBlobs` — wallet signs every blob transaction |
| Network | Testnet (`Network.TESTNET`) |
| Blob path | `videomind/videos/{id}/raw.{ext}` |
| Expiry | 47hr (1hr buffer under 48hr testnet cap) |
| Renewal | Cron every 6hr — currently no-op (wallet-owned blobs) |
| Explorer | https://explorer.shelby.xyz/testnet |


✅  Upload Flow


1. User drops video → POST /api/videos/prepare
   → Backend renames temp file, returns base64 + videoId

2. Frontend decodes bytes → useUploadBlobs()
   → Petra wallet popup → user signs → blob on Shelby ✅

3. Frontend → POST /api/videos/confirm
   → Backend fires AI pipeline (Whisper → Claude → Turso)

4. Frontend polls /api/videos/:id/status
   → Redirects to video page when ready

✅  Tech Stack

Shelby Protocol — Decentralised blob storage
Aptos Blockchain — Wallet signing + settlement
Anthropic Claude — Analysis, chat, search
OpenAI Whisper — Audio transcription
Turso / libSQL — Persistent database
Next.js 14 — Frontend
Express.js — Backend API


✅  Scripts

bash
# Backend
npm run dev      # Start with hot reload
npm run build    # Compile TypeScript
npm run renew    # Manual blob renewal check

# Frontend
npm run dev      # Start Next.js dev server
npm run build    # Production build

