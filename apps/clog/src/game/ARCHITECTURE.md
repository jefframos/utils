# Game Architecture Roadmap

This project is moving to a module-host architecture that supports large-scale growth, multi-canvas rendering, and worker offloading.

## Boundary Targets

- core
  - runtime orchestration, module host, contracts, lifecycle
- simulation
  - world model, tool logic, transport, deterministic game state
- rendering
  - scene graph, chunk draw systems, canvas surface management
- ui
  - windowing, panels, minimap controls, interaction wiring
- workers
  - off-main-thread compute and rendering pipelines

## Current Foundation

- Unified engine loop and behavior runtime
  - src/game/engine/GameEngine.ts
  - src/game/engine/BehaviorRuntime.ts
- Canvas surface registry for multi-canvas workloads
  - src/game/engine/CanvasSurfaceRegistry.ts
- Worker bridge + dedicated worker entry
  - src/game/engine/worker/RenderWorkerBridge.ts
  - src/game/engine/worker/render.worker.ts
- Module host + runtime module contracts
  - src/game/modules/RuntimeModule.ts
  - src/game/modules/ModuleHost.ts
- First migrated module: canvas surface module
  - src/game/modules/builtin/CanvasSurfaceModule.ts
- Minimap UI lifecycle migrated to module host
  - src/game/modules/builtin/MinimapUiModule.ts
- Minimap renderer bridge with worker/offscreen fallback
  - src/game/ui/minimap/MinimapRenderer.ts
  - src/game/ui/minimap/minimapRender.worker.ts

## Migration Sequence (Incremental)

1. bootstrap extraction
   - keep bootstrap as composition root only
   - move direct wiring into modules
2. rendering modules
  - world scene module
  - minimap render module (worker/offscreen path complete, continue optimization)
3. simulation modules
   - simulation state module
   - command/event bridge module
4. ui modules
   - window orchestration module
   - inventory/tool/map panel modules
5. worker modules
   - minimap raster worker
   - chunk meshing/visibility worker
   - simulation behavior worker

## Rules

- Every new subsystem should be introduced as a RuntimeModule.
- No direct cross-layer imports from ui to simulation internals; use module contracts or transport events.
- Worker boundaries must be message-contract based and serializable.
- Migrations should be file-by-file with behavior parity checks, not full rewrites.
