import type { WorldEntity, PlayerEntityCommandList, WorkerEntityCommandList } from '../world/WorldModel';
import { createContextMenuTemplate, type ContextMenuItem } from './ContextMenuTemplate';
import { createQueuedCommandItem, type QueuedCommandGroup } from './QueuedCommandItem';

type EntityFooterOptions = {
    onBuild?: () => void;
    onDeploy?: () => void;
    onRecall?: () => void;
    onRemoveQueuedCommand?: (commandId: string) => void;
    onInterruptCurrentCommand?: () => void;
    onTogglePauseCommands?: () => void;
    onClearCommands?: () => void;
};

export type EntityFooter = {
    setEntity: (entity: WorldEntity | null) => void;
    show: () => void;
    hide: () => void;
    destroy: () => void;
};

export function createEntityFooter(options: EntityFooterOptions): EntityFooter {
    const root = document.createElement('div');
    root.className = 'entity-footer';
    root.hidden = true;

    // Entity info section (left)
    const entityInfo = document.createElement('div');
    entityInfo.className = 'entity-footer-info';

    const entityIcon = document.createElement('div');
    entityIcon.className = 'entity-footer-icon';

    const entityName = document.createElement('div');
    entityName.className = 'entity-footer-name';

    entityInfo.append(entityIcon, entityName);

    // Actions section (middle)
    const actionsSection = document.createElement('div');
    actionsSection.className = 'entity-footer-actions';

    // Queue section (right)
    const queueSection = document.createElement('div');
    queueSection.className = 'entity-footer-queue';

    const queueLabel = document.createElement('span');
    queueLabel.className = 'entity-footer-queue-label';
    queueLabel.textContent = 'Queue:';

    const queueContainer = document.createElement('div');
    queueContainer.className = 'entity-footer-queue-container';

    queueSection.append(queueLabel, queueContainer);

    root.append(entityInfo, actionsSection, queueSection);
    document.body.appendChild(root);

    const contextMenu = createContextMenuTemplate('entity-footer-context-menu');
    document.body.appendChild(contextMenu.getRoot());

    let currentEntity: WorldEntity | null = null;
    let selectedCommandId: string | null = null;
    let queuedCommandItems: ReturnType<typeof createQueuedCommandItem>[] = [];

    const getEntityLabel = (entity: WorldEntity): string => {
        if (entity.kind === 'base') return 'Space Station';
        if (entity.kind === 'beacon') return 'Beacon';
        if (entity.kind === 'player') return 'Hero';
        if (entity.kind === 'worker') return entity.unitType === 'basic-worker' ? 'Basic Worker' : 'Worker';
        return 'Unknown';
    };

    const getEntityIcon = (entity: WorldEntity): string => {
        if (entity.kind === 'base') return '🏛️';
        if (entity.kind === 'beacon') return '🔴';
        if (entity.kind === 'player') return '👤';
        if (entity.kind === 'worker') return '🔧';
        return '❓';
    };

    const getQueuedCommandGroups = (entity: WorldEntity): QueuedCommandGroup[] => {
        const groups: QueuedCommandGroup[] = [];

        if (entity.kind === 'player' && entity.commandList) {
            const cmdList = entity.commandList as PlayerEntityCommandList;

            // Group by command type
            const typeMap = new Map<string, QueuedCommandGroup>();

            if (cmdList.current) {
                const id = `current-${cmdList.current.id}`;
                typeMap.set(id, {
                    id,
                    type: cmdList.current.type,
                    label: describePlayerCommand(cmdList.current.type, cmdList.current.payload),
                    count: 1,
                    paused: false,
                });
            } else if (entity.mining) {
                typeMap.set('current-active-mining', {
                    id: 'current-active-mining',
                    type: 'mine',
                    label: `Mine (${entity.mining.targetX}, ${entity.mining.targetY})`,
                    count: 1,
                    paused: false,
                });
            } else if (entity.movement && entity.movement.mode === 'move') {
                const dest = entity.movement.path[entity.movement.path.length - 1];
                typeMap.set('current-active-move', {
                    id: 'current-active-move',
                    type: 'move',
                    label: `Move (${dest?.x ?? '?'}, ${dest?.y ?? '?'})`,
                    count: 1,
                    paused: false,
                });
            }

            for (const cmd of cmdList.queue ?? []) {
                const id = `queued-${cmd.id}`;
                typeMap.set(id, {
                    id,
                    type: cmd.type,
                    label: describePlayerCommand(cmd.type, cmd.payload),
                    count: 1,
                    paused: false,
                });
            }

            groups.push(...typeMap.values());
        } else if (entity.kind === 'worker' && entity.commandList) {
            const cmdList = entity.commandList as WorkerEntityCommandList;

            const typeMap = new Map<string, QueuedCommandGroup>();

            if (cmdList.current) {
                const id = `current-${cmdList.current.id}`;
                typeMap.set(id, {
                    id,
                    type: cmdList.current.type,
                    label: describeWorkerCommand(cmdList.current.type, cmdList.current.payload),
                    count: 1,
                    paused: false,
                });
            }

            for (const cmd of cmdList.queue ?? []) {
                const id = `queued-${cmd.id}`;
                typeMap.set(id, {
                    id,
                    type: cmd.type,
                    label: describeWorkerCommand(cmd.type, cmd.payload),
                    count: 1,
                    paused: false,
                });
            }

            // If no commandList.current but worker is actively mining/moving, show a synthetic current
            if (!cmdList.current) {
                if (entity.mining) {
                    typeMap.set('current-active-mining', {
                        id: 'current-active-mining',
                        type: 'mine',
                        label: `Mine (${entity.mining.targetX}, ${entity.mining.targetY})`,
                        count: 1,
                        paused: false,
                    });
                    groups.unshift(typeMap.get('current-active-mining')!);
                } else if (entity.movement && entity.movement.mode === 'move') {
                    const dest = entity.movement.path[entity.movement.path.length - 1];
                    typeMap.set('current-active-move', {
                        id: 'current-active-move',
                        type: 'move',
                        label: `Move (${dest?.x ?? '?'}, ${dest?.y ?? '?'})`,
                        count: 1,
                        paused: false,
                    });
                    groups.unshift(typeMap.get('current-active-move')!);
                } else {
                    groups.push(...typeMap.values());
                    return groups;
                }
            } else {
                groups.push(...typeMap.values());
            }
        }

        return groups;
    };

    const describePlayerCommand = (type: string, payload: any): string => {
        if (type === 'move') return `Move (${payload.x ?? '?'}, ${payload.y ?? '?'})`;
        if (type === 'mine') return `Mine (${payload.x ?? '?'}, ${payload.y ?? '?'})`;
        if (type === 'build') return `Build ${payload.buildableType ?? '?'}`;
        return type;
    };

    const describeWorkerCommand = (type: string, payload: any): string => {
        if (type === 'mine') {
            return payload.repeat === false
                ? `Mine (${payload.x ?? '?'}, ${payload.y ?? '?'})`
                : `Mine (${payload.x ?? '?'}, ${payload.y ?? '?'}) [repeat]`;
        }
        if (type === 'move') return `Move (${payload.x ?? '?'}, ${payload.y ?? '?'})`;
        if (type === 'recall') return 'Recall to base';
        return type;
    };

    const getCommandControlItems = (entity: WorldEntity): ContextMenuItem[] => {
        if (entity.kind !== 'player' && entity.kind !== 'worker') {
            return [];
        }

        return [
            {
                id: 'toggle-pause',
                label: entity.commandsPaused ? 'Resume Queue' : 'Pause Queue',
                onSelect: () => {
                    options.onTogglePauseCommands?.();
                },
            },
            {
                id: 'interrupt-command',
                label: 'Interrupt Current Command',
                onSelect: () => {
                    options.onInterruptCurrentCommand?.();
                },
            },
            {
                id: 'clear-queue',
                label: 'Clear Command Queue',
                onSelect: () => {
                    options.onClearCommands?.();
                },
            },
        ];
    };

    const getActionMenuItems = (entity: WorldEntity): ContextMenuItem[] => {
        if (entity.kind === 'player') {
            const controls = getCommandControlItems(entity);
            const hasBuild = !!entity.builder?.buildables.length;
            return [
                {
                    id: 'player-actions-menu',
                    label: 'Player Actions',
                    submenuDirection: 'up',
                    children: [
                        {
                            id: 'player-build',
                            label: 'Build',
                            disabled: !hasBuild,
                            disabledReason: hasBuild ? undefined : 'No buildables available',
                            onSelect: () => {
                                options.onBuild?.();
                            },
                        },
                        ...controls,
                    ],
                },
            ];
        }

        if (entity.kind === 'worker') {
            const controls = getCommandControlItems(entity);
            return [
                {
                    id: 'worker-actions-menu',
                    label: 'Worker Actions',
                    submenuDirection: 'up',
                    children: [
                        {
                            id: entity.deployed ? 'worker-recall' : 'worker-deploy',
                            label: entity.deployed ? 'Recall Worker' : 'Deploy Worker',
                            onSelect: entity.deployed
                                ? () => {
                                    options.onRecall?.();
                                }
                                : () => {
                                    options.onDeploy?.();
                                },
                        },
                        ...controls,
                    ],
                },
            ];
        }

        return [];
    };

    const renderActions = (entity: WorldEntity): void => {
        actionsSection.textContent = '';

        const buttons: Array<{ label: string; onClick: () => void; hidden?: boolean }> = [];

        if (entity.kind === 'player') {
            buttons.push({
                label: 'Build',
                onClick: () => options.onBuild?.(),
                hidden: !entity.builder?.buildables.length,
            });
        } else if (entity.kind === 'worker') {
            buttons.push({
                label: entity.deployed ? 'Recall' : 'Deploy',
                onClick: entity.deployed ? () => options.onRecall?.() : () => options.onDeploy?.(),
            });
        }

        for (const btn of buttons) {
            if (btn.hidden) continue;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ui95-button entity-footer-action-btn';
            button.textContent = btn.label;
            button.addEventListener('click', btn.onClick);
            button.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                const items = getActionMenuItems(entity);
                if (items.length === 0) {
                    return;
                }
                contextMenu.open({
                    x: event.clientX,
                    y: event.clientY,
                    menuDirection: 'up',
                    items,
                });
            });
            actionsSection.appendChild(button);
        }
    };

    const renderQueue = (entity: WorldEntity): void => {
        queueContainer.textContent = '';

        // Clean up previous items
        queuedCommandItems.forEach((item) => item.destroy());
        queuedCommandItems = [];

        const groups = getQueuedCommandGroups(entity);

        if (groups.length === 0) {
            const empty = document.createElement('span');
            empty.className = 'entity-footer-queue-empty';
            empty.textContent = 'Idle';
            queueContainer.appendChild(empty);
            return;
        }

        for (const group of groups) {
            const commandItem = createQueuedCommandItem(group, {
                contextMenu,
                menuDirection: 'up',
                isSelected: selectedCommandId === group.id,
                onRemove: (commandId: string) => {
                    options.onRemoveQueuedCommand?.(commandId);
                },
                onInterrupt: () => {
                    options.onInterruptCurrentCommand?.();
                },
                onTogglePause: () => {
                    options.onTogglePauseCommands?.();
                },
            });

            const element = commandItem.render();
            element.addEventListener('click', () => {
                if (selectedCommandId === group.id) {
                    selectedCommandId = null;
                } else {
                    selectedCommandId = group.id;
                }
                renderQueue(entity);
            });

            queueContainer.appendChild(element);
            queuedCommandItems.push(commandItem);
        }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
        if (!currentEntity || !selectedCommandId) return;

        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            if (selectedCommandId.startsWith('queued-')) {
                const actualId = selectedCommandId.replace(/^queued-/, '');
                options.onRemoveQueuedCommand?.(actualId);
            } else if (selectedCommandId.startsWith('current-')) {
                options.onInterruptCurrentCommand?.();
            }
            selectedCommandId = null;
        }
    };

    document.addEventListener('keydown', handleKeyDown);

    return {
        setEntity: (entity) => {
            currentEntity = entity;
            selectedCommandId = null;

            if (!entity) {
                root.hidden = true;
                return;
            }

            // Update entity info
            entityIcon.textContent = getEntityIcon(entity);
            entityName.textContent = getEntityLabel(entity);

            // Render actions and queue
            renderActions(entity);
            renderQueue(entity);

            root.hidden = false;
        },
        show: () => {
            root.hidden = false;
        },
        hide: () => {
            root.hidden = true;
        },
        destroy: () => {
            document.removeEventListener('keydown', handleKeyDown);
            queuedCommandItems.forEach((item) => item.destroy());
            contextMenu.destroy();
            root.remove();
        },
    };
}
