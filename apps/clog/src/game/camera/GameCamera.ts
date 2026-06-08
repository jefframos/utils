import { Application, Container, Point } from 'pixi.js';

export type WorldViewportRect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

export class GameCamera {
    constructor(
        private readonly app: Application,
        private readonly container: Container,
    ) { }

    setScale(scale: number): void {
        this.container.scale.set(scale);
    }

    getScale(): number {
        return this.container.scale.x;
    }

    panByScreen(dx: number, dy: number): void {
        this.container.position.x += dx;
        this.container.position.y += dy;
    }

    zoomAtStagePoint(stagePoint: Point, factor: number, minZoom: number, maxZoom: number): void {
        const before = this.container.toLocal(stagePoint);
        const nextScale = Math.max(minZoom, Math.min(maxZoom, this.container.scale.x * factor));
        this.container.scale.set(nextScale);

        const after = this.container.toGlobal(before);
        this.container.position.x += stagePoint.x - after.x;
        this.container.position.y += stagePoint.y - after.y;
    }

    stageToWorld(stagePoint: Point): Point {
        return this.container.toLocal(stagePoint);
    }

    worldToStage(worldPoint: Point): Point {
        return this.container.toGlobal(worldPoint);
    }

    centerOnWorld(worldX: number, worldY: number): void {
        this.centerOnWorldAtStage(worldX, worldY, this.app.screen.width * 0.5, this.app.screen.height * 0.5);
    }

    centerOnWorldAtStage(worldX: number, worldY: number, stageX: number, stageY: number): void {
        const stageTarget = new Point(stageX, stageY);
        const stageCurrent = this.container.toGlobal(new Point(worldX, worldY));

        this.container.position.x += stageTarget.x - stageCurrent.x;
        this.container.position.y += stageTarget.y - stageCurrent.y;
    }

    getViewportWorldRect(): WorldViewportRect {
        const topLeft = this.container.toLocal(new Point(0, 0));
        const bottomRight = this.container.toLocal(new Point(this.app.screen.width, this.app.screen.height));

        return {
            left: Math.min(topLeft.x, bottomRight.x),
            top: Math.min(topLeft.y, bottomRight.y),
            right: Math.max(topLeft.x, bottomRight.x),
            bottom: Math.max(topLeft.y, bottomRight.y),
        };
    }
}
