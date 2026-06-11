# Entity Type Reference

This document outlines the components and capabilities of each entity type in the game world. Each entity is composed of optional components that define its behavior.

## Entity Types Overview

### Base (Space Station)
- **Mobility**: Static
- **Cost**: 0 ore
- **Visibility**: 7 tiles
- **Health**: 500 HP
- **Components**:
  - `spawner`: Can spawn workers (max 10 workers)
  - `life`: Health system enabled
- **Capabilities**:
  - Spawn worker-miner units
  - Acts as home base and dropoff point for workers
- **Behavior**: None (static, acts as hub)

### Player (Hero)
- **Mobility**: Dynamic
- **Cost**: 0 ore
- **Visibility**: 14 tiles (long vision)
- **Health**: 100 HP
- **Components**:
  - `movement`: Speed 2.5 tiles/sec
  - `mining`: Mine power 1, cooldown 160ms, carry capacity 999
  - `inventory`: Capacity 999
  - `life`: Health system enabled
  - `builder`: Can place beacons
- **Capabilities**:
  - Move around the world
  - Mine ore directly
  - Build beacons for visibility
  - Command queue (move, build actions)
- **Behavior**: Player-controlled via command queue

### Worker-Miner (Basic Worker)
- **Mobility**: Dynamic
- **Cost**: 5 ore
- **Visibility**: 8 tiles
- **Health**: 50 HP
- **Components**:
  - `movement`: Speed 2.0 tiles/sec
  - `mining`: Mine power 1, cooldown 200ms, carry capacity 1
  - `inventory`: Capacity 1 (one ore at a time)
  - `life`: Health system enabled
- **Capabilities**:
  - Move to locations
  - Mine ore at mining commands
  - Carry ore and return to home base
  - Command queue (move, mine, recall actions)
- **Behavior**: Responds to commands (move, mine, recall)

### Beacon (Visibility Extension)
- **Mobility**: Static
- **Cost**: 10 ore
- **Visibility**: 10 tiles
- **Health**: 100 HP
- **Components**:
  - `life`: Health system enabled
- **Capabilities**:
  - Extends visibility in network
  - Links to parent beacon or base
- **Behavior**: None (static visibility node)

## Component Descriptions

| Component | Purpose | Entities |
|-----------|---------|----------|
| `movement` | Enables pathfinding and movement | Player, Worker-Miner |
| `mining` | Enables ore gathering | Player, Worker-Miner |
| `inventory` | Enables item carrying | Player, Worker-Miner |
| `life` | Enables health system | All |
| `builder` | Enables construction of structures | Player |
| `spawner` | Enables unit spawning | Base |
| `visibility` | Enables vision radius | All |

## Build/Spawn Limits

**Base Spawner**:
- Can spawn: `worker-miner`
- Max count: 10 worker-miners
- Respawn: Workers cost 5 ore each

**Player Builder**:
- Can build: `beacon`
- No limit on beacons (player can build as many as needed)

## Cost Table

| Entity Type | Cost |
|------------|------|
| Base | 0 ore (starting entity) |
| Player | 0 ore (starting entity) |
| Worker-Miner | 5 ore |
| Beacon | 10 ore |

## Movement & Mining Properties

| Entity | Move Speed | Mine Power | Mine Cooldown | Carry Capacity |
|--------|-----------|-----------|---------------|----------------|
| Player | 2.5 t/s | 1x | 160ms | 999 ore |
| Worker-Miner | 2.0 t/s | 1x | 200ms | 1 ore |

## System Architecture

- **MovementSystem**: Handles all entity pathfinding and position updates
- **MiningSystem**: Handles ore gathering, cooldowns, and retargeting
- **CommandQueueSystem**: Manages command progression and entity actions
- **EntityDefinitions**: Centralized data about entity types, costs, and capabilities

All systems are decoupled from WorldModel and can be tested independently.
