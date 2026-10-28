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
  - Adapted from `ToninoTarsi/task-creator` (`julien66/task-creator`).
  - Converts turnpoint coordinates (`centerLat`, `centerLon`) to UTM (`utm.fromLatLon`), anchoring the UTM zone number and letter so all turnpoints share a consistent Cartesian projection.
  - Iteratively adjusts target points `(fx, fy)` on each cylinder of radius `radius` using line-circle intersection and reflection (`optimize()`), converging until total path distance changes by `< 1.0m` (up to `count * 10` steps).
  - **ESS (`esIndex`) Handling**: For `index == points.length - 1` or `index == esIndex`, the outgoing reference point `b` uses the target cylinder's center `c`.
  - Converts the optimized `(fx, fy)` back to WGS84 (`utm.toLatLon`) and stores them in `route.lat` and `route.lon`, while preserving `centerLat`, `centerLon`, and `radius`.
  - **Cylinder Clamping (`clampToCylinder`)**: Uses spherical geometry (`EARTH_RADIUS = 6378137`, matching `google.maps.Circle` and `google.maps.geometry.spherical`) to check if a point lies within `cylinder.radius` of `(cylinder.lat, cylinder.lon)`. If outside, projects the point onto the cylinder perimeter along the great-circle bearing from the cylinder center.

### Frontend Task & Cylinder Rendering (`apps/fxc-front`)
- **State (`apps/fxc-front/src/app/redux/planner-slice.ts`)**:
  - `planner.route`: Encoded circuit string representing the route polyline vertices (initialized from `route.lat` / `route.lon`, which are the optimized points on the cylinders).
  - `planner.cylinders`: Array of `Cylinder` (`{ lat, lon, radius }`) populated by `fetchTrack` (`apps/fxc-front/src/app/redux/track-slice.ts`) when a `MetaTrackGroup` contains a `route` with `centerLat`, `centerLon`, and `radius`.
  - Calling `setRoute('')` (e.g. closing or resetting the planner/route) also clears `planner.cylinders`.
- **2D Map Rendering & Task Conformance (`apps/fxc-front/src/app/components/2d/path-element.ts`)**:
  - Subscribes to `plannerSlice.selectCylinders(state)`.
  - Renders `google.maps.Circle` overlays for each cylinder with `radius > 0` (`strokeColor: '#0000ff'`, `fillColor: '#0000ff'`, `clickable: false`).
  - Unions each circle's bounds into the `LatLngBounds` when fitting the map to the loaded route, ensuring full cylinders remain visible inside the viewport.
  - Cleans up `cylinderCircles` on re-render and `disconnectedCallback()`.
  - **Conforming Turnpoints to Cylinders**:
    - On `set_at` (when a user drags a turnpoint vertex `index`), if `index < this.cylinders.length`, `handleSetAt(index)` clamps the new coordinates via `clampToCylinder(pt, this.cylinders[index])` and updates the vertex on the `MVCArray` (guarded by `this.isClamping` to prevent recursive `set_at` loops) before syncing state and re-scoring.
    - When `this.cylinders.length > 0`, adding new vertices via midpoint dragging (`insert_at`), map right-click (`appendToPath`), or `close-flight`, as well as deleting vertices via vertex right-click / double-click, are blocked so the route always conforms to the task's turnpoint sequence.
