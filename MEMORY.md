# Project Memory (`flyXC`)

This document serves as the source of truth for architectural decisions, system design, domain models, environment configuration, and tricky edge cases in `flyXC`.

## 1. Environment & Development Server

### Node.js & Package Manager
- **Required versions**: Node.js `^24.22.1` and `pnpm@11.10.0`.
- **Local binary path**: Because the system default `/usr/bin/node` is v20 (which lacks `node:sqlite` required by `pnpm@11.10.0`), Node 24 is installed at `~/.local/node24`. Always prepend `export PATH=$HOME/.local/node24/bin:$HOME/.local/bin:$PATH` when running commands.

### Secrets & Environment Variables (`dotenvx`)
- **Backend (`fxc-server`, `fetcher`, `fxc-tiles`, `misc`, `proxy`, `run`)**:
  - Each backend app's `vite.config.ts` loads `secrets.env.local` before `secrets.env` at the repo root (`flyXC/secrets.env.local`).
  - `secrets.env.local` is gitignored and holds local overrides (`REDIS_URL=redis://localhost:6378`, `REDIS_URL_DEV=redis://localhost:6378`, and dummy secrets for local dev).
- **Frontend (`apps/fxc-front`)**:
  - `apps/fxc-front/vite.config.ts` invokes `dotenvx.config({ path: 'apps/fxc-front/.env.development', envKeysFile: '../../.env.keys' })` when `mode === 'development'`.
  - **Edge Case**: When `.env.keys` is missing, `dotenvx.config()` still populates `process.env` with raw `encrypted:...` values. Because Vite's `loadEnv` does not overwrite existing `process.env` keys, `.env.development.local` will NOT override keys present in `.env.development`.
  - **Solution**: Always update `apps/fxc-front/.env.development` directly using `dotenvx` with `--plain` for local unencrypted values:
    ```bash
    pnpm dlx @dotenvx/dotenvx set <KEY> "<VALUE>" --plain -f apps/fxc-front/.env.development
    ```

### Docker Emulators (`docker/docker-compose.yml`)
- **Services**:
  - `redis`: Host port `6378` -> Container port `6379`.
  - `datastore`: Google Cloud Datastore emulator on `0.0.0.0:8081` (`--project=fly-xc`).
  - `pubsub`: Google Cloud Pub/Sub emulator on `0.0.0.0:8085` (`--project=fly-xc`).
- **Required Pub/Sub Topic**:
  - Uploading tracks/routes (`/api/track/upload.pbf`) calls `queueTrackPostProcessing(id)`, which publishes to the `track.upload` topic.
  - Ensure the topic exists in the emulator (`PUT http://localhost:8085/v1/projects/fly-xc/topics/track.upload`).
- **Dev Server Launch Command**:
  ```bash
  export PATH=$HOME/.local/node24/bin:$HOME/.local/bin:$PATH
  export NX_TUI=false
  export DATASTORE_EMULATOR_HOST=localhost:8081
  export DATASTORE_PROJECT_ID=fly-xc
  export PUBSUB_EMULATOR_HOST=localhost:8085
  export GOOGLE_CLOUD_PROJECT=fly-xc
  pnpm dev
  ```
- **Rebuilding `fxc-server`**:
  - `fxc-server:serve` runs `node apps/fxc-server/dist/index.js` without file watching.
  - Whenever `libs/common`, `libs/common-node`, or `apps/fxc-server` changes, run `pnpm nx run fxc-server:build:development` and restart `pnpm dev` so the running server reflects the latest build.

---

## 2. Domain Models & Architecture

### Track & Route Protocol Buffers (`libs/common/src/protos/track.proto`)
- Tracks and routes are serialized between `fxc-server` and `fxc-front` using `protobuf-ts` (`@flyxc/common`).
- After modifying `libs/common/src/protos/track.proto`, regenerate TypeScript definitions via `pnpm --filter @flyxc/common proto` (or `npx protoc --ts_out ./libs/common/src/protos --proto_path ./libs/common/src/protos ./libs/common/src/protos/track.proto`).
- **`Route` Message**:
  - `lat` (`repeated float`, tag 1), `lon` (`repeated float`, tag 2), `alt` (`repeated int32`, tag 3): Coordinates of the **optimized route path** (or turnpoint sequence).
  - `center_lat` (`repeated float`, tag 4), `center_lon` (`repeated float`, tag 5): Coordinates of the **turnpoint cylinder centers**.
  - `radius` (`repeated uint32`, tag 6): Turnpoint cylinder radii in meters.
  - Note: Unlike `Track` (which is differential-encoded via `libs/common/src/lib/runtime-track.ts`), `MetaTrackGroup.route` stores raw float coordinates directly.

### Competition Task Optimization (`.xctsk`)
- **Parser (`apps/fxc-server/src/app/parser/xctsk.ts`)**:
  - Parses JSON `.xctsk` files, extracting each turnpoint's `lat`, `lon`, `altSmoothed`, `radius`, and detecting the End of Speed Section (`tp.type === 'ESS'`, passed as `esIndex`).
  - Populates `centerLat`, `centerLon`, and `radius` on `protos.Route`, then runs `optimizeTask(route, esIndex)` from `libs/common/src/lib/tasks.ts`.
- **Optimization Algorithm (`libs/common/src/lib/tasks.ts`)**:
  - Converts turnpoint coordinates (`centerLat`, `centerLon`) to UTM (`utm.fromLatLon`), anchoring the UTM zone number and letter to the first turnpoint so all turnpoints share a consistent Cartesian projection.
  - Iteratively adjusts target points `(fX[i], fY[i])` on each cylinder of radius `r[i]` using the angle bisector / ray-circle intersection method (`optimize()`), converging until total path distance changes by `< 0.1m` (up to 100 iterations).
  - **ESS (`esIndex`) Handling**: When `esIndex !== -1`, points at `i >= esIndex` (End of Speed Section and Goal) use the next point (`esIndex + 1`, or `esIndex - 1` if `esIndex` is the last point) as their outgoing reference `bIdx`, matching standard XC competition scoring rules where the shortest path aims toward Goal through the ESS cylinder.
  - Converts the optimized `(fX[i], fY[i])` back to WGS84 (`utm.toLatLon`, rounded to 5 decimal places) and stores them in `route.lat` and `route.lon`, while preserving `centerLat`, `centerLon`, and `radius`.

### Frontend Task & Cylinder Rendering (`apps/fxc-front`)
- **State (`apps/fxc-front/src/app/redux/planner-slice.ts`)**:
  - `planner.route`: Encoded circuit string representing the route polyline vertices (initialized from `route.lat` / `route.lon`, which are the optimized points on the cylinders).
  - `planner.cylinders`: Array of `Cylinder` (`{ lat, lon, radius }`) populated by `fetchTrack` (`apps/fxc-front/src/app/redux/track-slice.ts`) when a `MetaTrackGroup` contains a `route` with `centerLat`, `centerLon`, and `radius`.
  - Calling `setRoute('')` (e.g. closing the planner/route) also clears `planner.cylinders`.
- **2D Map Rendering (`apps/fxc-front/src/app/components/2d/path-element.ts`)**:
  - Subscribes to `plannerSlice.selectCylinders(state)`.
  - Renders `google.maps.Circle` overlays for each cylinder with `radius > 0` (`strokeColor: '#FF00FF'`, `fillColor: '#FF00FF'`, `clickable: false`).
  - Unions each circle's bounds into the `LatLngBounds` when fitting the map to the loaded route (`centerMap`), ensuring full cylinders remain visible inside the viewport.
  - Cleans up `cylinderCircles` on re-render and `disconnectedCallback()`.
