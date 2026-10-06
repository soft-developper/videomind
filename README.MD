VideoMind - AI-First Video Intelligence Platform

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

Storage Lifetime


Storage is prepaid at registration for a fixed number of 24-hour payment epochs (set by the Shelby contract)
There is no expiry argument and no renewal call; the app does not renew blobs
Each video's On-chain proof panel shows the date its storage is paid until


Features

Video upload → Shelby Testnet✅

Persistent storage in Turso✅

Whisper transcription✅

Claude chapters / highlights / summary✅

Blog post & X thread generation✅

AI Q&A chat per video✅

Semantic search across all videos✅

On-chain proof with paid-until date✅

Video streaming from Shelby✅

Delete video (DB + cascade)✅


Built With


Shelby Protocol - Decentralized blob storage (Testnet)

Turso / libSQL - Persistent relational database

Aptos Blockchain - Coordination & settlement layer

Anthropic Claude - Video analysis, Q&A, content generation

OpenAI Whisper - Audio transcription

Next.js 14 - Frontend (App Router)

Express.js - Backend API server
