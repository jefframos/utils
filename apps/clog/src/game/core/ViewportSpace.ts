import { Application, Point } from 'pixi.js';
import { GameCamera, type WorldViewportRect } from '../camera/GameCamera';

export type RectCorners = {
    topLeft: Point;
    topRight: Point;
    bottomLeft: Point;
    bottomRight: Point;
};

export type ViewRect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    center: Point;
    corners: RectCorners;
};

export type ViewportSpaceSnapshot = {
    screen: ViewRect;
    overlay: ViewRect;
    world: ViewRect;
};

export type OverlayPadding = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

function createRect(left: number, top: number, right: number, bottom: number): ViewRect {
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    return {
        left,
        top,
        right,
        bottom,
        width,
        height,
        center: new Point(left + width * 0.5, top + height * 0.5),
        corners: {
            topLeft: new Point(left, top),
            topRight: new Point(right, top),
            bottomLeft: new Point(left, bottom),
            bottomRight: new Point(right, bottom),
        },
    };
}

export class ViewportSpace {
    private static instance: ViewportSpace | null = null;

    static initialize(app: Application, camera: GameCamera): ViewportSpace {
        if (!ViewportSpace.instance) {
            ViewportSpace.instance = new ViewportSpace(app, camera);
        }
        return ViewportSpace.instance;
    }

    static get(): ViewportSpace {
        if (!ViewportSpace.instance) {
            throw new Error('ViewportSpace is not initialized. Call ViewportSpace.initialize first.');
        }
        return ViewportSpace.instance;
    }

    // Padding is provided in CSS pixel space (DOM layout units).
    private overlayPadding: OverlayPadding = { left: 0, top: 0, right: 0, bottom: 0 };

    private constructor(
        private readonly app: Application,
        private readonly camera: GameCamera,
    ) { }

    setOverlayPadding(padding: Partial<OverlayPadding>): void {
        this.overlayPadding = {
            left: Number.isFinite(padding.left) ? Number(padding.left) : this.overlayPadding.left,
            top: Number.isFinite(padding.top) ? Number(padding.top) : this.overlayPadding.top,
            right: Number.isFinite(padding.right) ? Number(padding.right) : this.overlayPadding.right,
            bottom: Number.isFinite(padding.bottom) ? Number(padding.bottom) : this.overlayPadding.bottom,
        };
    }

    private getCssToStageScale(): { x: number; y: number } {
        const rect = this.app.canvas.getBoundingClientRect();
        const x = rect.width > 0 ? this.app.screen.width / rect.width : 1;
        const y = rect.height > 0 ? this.app.screen.height / rect.height : 1;
        return { x, y };
    }

    getScreenRect(): ViewRect {
        return createRect(0, 0, this.app.screen.width, this.app.screen.height);
    }

    getScreenCenter(): Point {
        return this.getScreenRect().center;
    }

    getScreenCorners(): RectCorners {
        return this.getScreenRect().corners;
    }

    getOverlayRect(): ViewRect {
        const screen = this.getScreenRect();
        const cssToStage = this.getCssToStageScale();
        const leftInset = this.overlayPadding.left * cssToStage.x;
        const topInset = this.overlayPadding.top * cssToStage.y;
        const rightInset = this.overlayPadding.right * cssToStage.x;
        const bottomInset = this.overlayPadding.bottom * cssToStage.y;
        const left = Math.max(screen.left, leftInset);
        const top = Math.max(screen.top, topInset);
        const right = Math.max(left, screen.right - rightInset);
        const bottom = Math.max(top, screen.bottom - bottomInset);
        return createRect(left, top, right, bottom);
    }

    getOverlayCenter(): Point {
        return this.getOverlayRect().center;
    }

    getOverlayCorners(): RectCorners {
        return this.getOverlayRect().corners;
    }

    getWorldRect(): ViewRect {
        const rect: WorldViewportRect = this.camera.getViewportWorldRect();
        return createRect(rect.left, rect.top, rect.right, rect.bottom);
    }

    getWorldCenter(): Point {
        return this.getWorldRect().center;
    }

    getWorldCorners(): RectCorners {
        return this.getWorldRect().corners;
    }

    getSnapshot(): ViewportSpaceSnapshot {
        return {
            screen: this.getScreenRect(),
            overlay: this.getOverlayRect(),
            world: this.getWorldRect(),
        };
    }
}
