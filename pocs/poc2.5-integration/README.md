# POC 2.5: Three.js WebGPU + SpacetimeDB Integration

Connects POC 1 (WebGPU rendering) with POC 2 (SpacetimeDB backend) into an interactive multiplayer demo.

## Prerequisites
- SpacetimeDB running locally (`spacetime start`)
- POC 2 module published (`cd ../poc2-spacetimedb && ./verify.sh`)

## Setup
npm install
npm run dev

## Usage
- Open http://localhost:3001 in Chrome
- Open a second tab to see multiplayer sync
- Left-click ground to spawn creatures
- Right-click creature to select, right-click ground to move it
- Watch creatures move in real-time as the server tick processes movement
