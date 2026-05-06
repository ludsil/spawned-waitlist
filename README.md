# spawned waitlist

Single-page waitlist app for [spawned](https://spawned.ai), deployed at <https://list.spawned.app>.

ASCII cloud animation background, an email field, and a SQLite store for signups.

## Stack

- **Runtime:** Bun (`oven/bun:1`)
- **Server:** `Bun.serve` (`server.ts`)
- **Storage:** SQLite via `bun:sqlite`, persisted on EFS at `/data`
- **Front-end:** vanilla JS canvas animation (`public/app.js`)

## Endpoints

| Method | Path           | Purpose                          |
| ------ | -------------- | -------------------------------- |
| GET    | `/`            | Single-page UI                   |
| GET    | `/health`      | ALB health check                 |
| POST   | `/api/signup`  | `{ "email": "..." }` → persists |
| GET    | `/api/count`   | Total signups                    |

## Deployment

Provisioned by spawned via `infra.json` (kept in the homesite workspace, not this repo). Container runs on the shared `spawned-vpc` / `spawned-lb` with EFS mount for the SQLite file.
