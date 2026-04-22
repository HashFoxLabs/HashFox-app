# HashFox

HashFox is a unified paper-trading platform built on Solana + Anchor, with a single SvelteKit frontend and a single on-chain program.

## Repo layout

```
HashFox-app/
├── contracts/                   # Anchor workspace (programs/hashfox)
├── frontend/                    # SvelteKit app
├── .env.example                 # Root env template (frontend + contracts)
├── .gitignore
├── package.json                 # Root scripts (frontend + contracts)
└── README.md
```

## Setup

```sh
# 1. Clone
git clone git@github.com:HashFoxLabs/HashFox-app.git
cd HashFox-app

# 2. Configure env
cp .env.example .env
# Fill in real values (Supabase keys, Stream keys, program ID)

# 3. Install frontend deps
npm install
```

## Development

```sh
npm run dev                    # http://localhost:5173
```

## Building

```sh
npm run build
```

## Contracts (Anchor)

```sh
npm run anchor:build
```

If you have Anchor installed and a Solana wallet configured, you can also run:

```sh
npm run anchor:test
npm run anchor:deploy
```
