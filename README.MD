VideoMind — AI-First Video Intelligence Platform

Built on Shelby Protocol (Testnet) · Powered by Claude + Whisper · Persisted on Turso


Turn every video into an AI-searchable knowledge base.

Shelby Integration

Network


Testnet (Network.TESTNET)
RPC: https://api.testnet.shelby.xyz
Explorer: https://explorer.shelby.xyz/testnet


Blob Naming

videomind/videos/{uuid}/raw.mp4           ← Raw video
videomind/videos/{uuid}/transcript.json  ← Whisper transcript
videomind/videos/{uuid}/meta.json        ← All AI outputs

48-Hour Expiration Handling


All blobs uploaded with 47-hour expiry
Cron runs every 6 hours, re-uploads blobs expiring within 12 hours
Renewal timestamps persisted back to Turso


Features

Video upload → Shelby Testnet✅

Persistent storage in Turso✅

Whisper transcription✅

Claude chapters / highlights / summary✅

Blog post & X thread generation✅

AI Q&A chat per video✅

Semantic search across all videos✅

Auto blob renewal (48hr limit)✅

Video streaming from Shelby✅

Delete video (DB + cascade)✅


Built With


Shelby Protocol — Decentralized blob storage (Testnet)

Turso / libSQL — Persistent relational database

Aptos Blockchain — Coordination & settlement layer

Anthropic Claude — Video analysis, Q&A, content generation

OpenAI Whisper — Audio transcription

Next.js 14 — Frontend (App Router)

Express.js — Backend API server
