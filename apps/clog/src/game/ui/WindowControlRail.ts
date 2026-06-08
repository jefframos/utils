export type WindowControlRailOrientation = 'vertical' | 'horizontal';

type CreateWindowControlRailOptions = {
    orientation: WindowControlRailOrientation;
    className?: string;
};

type CreateWindowControlRailButtonOptions = {
    iconHtml: string;
    tooltip: string;
    className?: string;
};

export type WindowControlRail = {
    root: HTMLDivElement;
    createButton: (options: CreateWindowControlRailButtonOptions) => HTMLButtonElement;
};

export function createWindowControlRail(options: CreateWindowControlRailOptions): WindowControlRail {
    const root = document.createElement('div');
    root.className = `window-control-rail is-${options.orientation}${options.className ? ` ${options.className}` : ''}`;

    const createButton = (buttonOptions: CreateWindowControlRailButtonOptions): HTMLButtonElement => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `ui95-button window-control-rail-button${buttonOptions.className ? ` ${buttonOptions.className}` : ''}`;
        button.title = buttonOptions.tooltip;
        button.innerHTML = buttonOptions.iconHtml;
        return button;
    };

    return { root, createButton };
}
