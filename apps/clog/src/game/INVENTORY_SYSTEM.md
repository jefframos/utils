# Inventory System Implementation

## Overview
A comprehensive inventory system with the following features:
- Entity-specific inventory tracking (player, workers, base)
- Capacity constraints and full inventory handling
- Item transfer between entities (ore mining → base)
- Automatic dropoff routing when base is full
- Visual inventory display in the entity footer
- Mining pause when inventory is full

## Components Created

### 1. InventorySystem (`systems/InventorySystem.ts`)
**Purpose**: Core inventory state and transfer management

**Key Methods**:
- `initializeInventory(entityId, capacity)` - Setup inventory for entity
- `getInventory(entityId)` - Get inventory data
- `addItems(entityId, resourceType, amount)` - Add items (respects capacity)
- `removeItems(entityId, resourceType, amount)` - Remove items
- `transferItems(fromId, toId, resourceType, amount)` - Move between entities
- `isFull(entityId)` - Check capacity
- `hasSpaceFor(entityId, amount)` - Check if space available
- `findNearestDropoffPoint()` - Find container for ore when full

**Data Structure**:
```typescript
interface EntityInventory {
  capacity: number;
  slots: Array<{ resourceType: string; amount: number }>
}
```

### 2. InventoryDisplay (`ui/InventoryDisplay.ts`)
**Purpose**: Visual representation of inventory in footer

**Features**:
- Shows inventory slots with resource icons
- Displays current/max capacity
- Hovers to show resource details
- Icon for ore: ⬙

### 3. EntityFooter Updates
**Changes**:
- Added `getInventory` callback option
- Added inventory section between entity info and actions
- Calls `renderInventory()` to display capacity and slots
- Actions move to footer (no longer in EntityDetailsWindow)

**New Layout**:
```
[Icon] [Name] | [Inventory] | [Actions] | [Command Queue]
```

### 4. MiningSystem Updates
**Context additions**:
- `canAddToInventory(entityId, amount)` - Check if entity has space
- `findNearestDropoff()` - Find alternative storage location

**Behavior**:
- When ore gathered: checks if worker inventory has space
- If full: checks if home base has space
- If home full: finds nearest alternative dropoff
- If no space anywhere: mining pauses, returns true to end command
- Workers automatically return when inventory full

### 5. CSS Styling
**Classes added**:
- `.entity-footer-inventory` - Inventory section container
- `.inventory-display` - Inventory display wrapper
- `.inventory-display-label` - "Inventory:" label
- `.inventory-display-slots` - Slots container
- `.inventory-slot` - Individual slot styling
- `.inventory-slot-icon` - Resource icon
- `.inventory-slot-amount` - Quantity display
- `.inventory-display-capacity` - "X/Y" capacity indicator

## Integration Points

### In WorldModel constructor:
```typescript
// Initialize InventorySystem
this.inventorySystem = new InventorySystem({
  getEntity: (id) => this.entities.get(id) ?? null,
  findNearestInventoryContainer: (x, y, ignoreId) => /* find nearby entity with inventory */,
  isInBaseDropoffZone: (base, x, y) => /* check if in base area */,
});

// Initialize all entity inventories on load
for (const entity of this.entities.values()) {
  if (entity.inventoryDef) {
    this.inventorySystem.initializeInventory(entity.id, entity.inventoryDef.capacity);
  }
}
```

### In MiningSystem context:
```typescript
miningSystem = new MiningSystem({
  // ... existing context
  canAddToInventory: (entityId, amount) => 
    this.inventorySystem.hasSpaceFor(entityId, amount),
  findNearestDropoff: (worker, resourceType, amount) =>
    this.inventorySystem.findNearestDropoffPoint(worker, resourceType, amount),
});
```

### In EntityFooter options:
```typescript
footer = createEntityFooter({
  // ... existing options
  getInventory: (entityId) => {
    const inv = this.inventorySystem.getInventory(entityId);
    return inv ? {
      capacity: inv.capacity,
      slots: inv.slots,
    } : null;
  },
});
```

### When ore is gathered (WorldModel.tickFixed):
```typescript
// When a mining hit opens ore:
const amountAdded = this.inventorySystem.addItems(
  worker.id,
  'ore',
  hit.oreAmount ?? 1
);

// If inventory full, trigger return to base/dropoff
if (!this.inventorySystem.hasSpaceFor(worker.id, 1)) {
  // Generate return path to base or dropoff
}
```

### When worker returns home:
```typescript
// Transfer ore from worker to base
const transferred = this.inventorySystem.transferItems(
  worker.id,
  home.id,
  'ore',
  amountInWorker
);

// Queue ore delivery event
this.pendingWorkerOreDeliveries.push({
  workerId: worker.id,
  homeId: home.id,
  amount: transferred,
});
```

## Entity Inventory Definitions

From `entityDefinitions.ts`:

| Entity | Capacity | Type |
|--------|----------|------|
| Base | 1000 ore | Large storage |
| Player | 999 ore | Personal carrying |
| Worker | 1 ore | Small carrier |
| Beacon | 0 | No storage |

## Behavior Flows

### Mining Flow:
1. Worker mines ore
2. InventorySystem.addItems() checks capacity
3. If full: check base capacity
4. If base full: find nearest dropoff container
5. If no space: pause mining, stop command
6. If space available: continue mining
7. When inventory full: return to storage point

### Dropoff Flow:
1. Worker returns to base (or nearest dropoff)
2. Upon arrival: InventorySystem.transferItems()
3. Ore moves: worker inventory → base/container inventory
4. Worker cleared, ready for next command

### Full Base Flow:
1. Base inventory reaches capacity
2. New ore arrives at worker
3. InventorySystem finds alternative dropoff
4. Worker reroutes to alternate location
5. If no alternative: worker stops in place, paused

## Status

✅ **Created Components**:
- InventorySystem
- InventoryDisplay  
- EntityFooter inventory integration
- MiningSystem inventory checks
- CSS styling for inventory display

⚠️ **Pending Integration**:
- Wire InventorySystem into WorldModel
- Initialize inventories for entities
- Add ore transfer on worker return
- Implement findNearestInventoryContainer in WorldModel
- Update mining command to check inventory before accepting

## Next Steps

1. **Instantiate InventorySystem in WorldModel**
2. **Initialize all entity inventories** on creation and load
3. **Update MiningSystem context** in WorldModel constructor
4. **Add ore transfer logic** in tickFixed when worker returns
5. **Implement findNearestInventoryContainer** for dropoff routing
6. **Wire EntityFooter getInventory callback** in GameScene
7. **Test inventory constraints** - mining pause when full
8. **Test dropoff routing** - alternative storage when base full
