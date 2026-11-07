# Bank It

Multiplayer Bank dice game. Everyone plays on their own phone; put the Live Screen on a TV.

## Setup (same as Beat Sheet)
1. Firebase console -> new project -> add a Web app -> copy the config into `src/firebase.js`.
2. Turn on Realtime Database. In its Rules tab, paste the contents of `database.rules.json` (instead of leaving "test mode", which expires).
3. Put your Firebase apiKey in `netlify.toml` (SECRETS_SCAN line).
4. Upload this folder to a new GitHub repo (everything except node_modules and dist), connect it in Netlify. Done.

## Using it
- Players tab: add everyone's name once (saved for good).
- Pick your name at the top, tap Join, then anyone taps Start.
- Each turn: roll with App dice or tap in what your Real dice show.
- Anyone can tap BANK on their own phone before the next roll.
- Live Screen: tap the TV tab, or open the site with `?screen` at the end of the address.
- Stats (games, wins, best, average) save automatically after each finished game.
