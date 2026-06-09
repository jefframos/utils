import { expect, test } from '@playwright/test';

test('game boots without runtime console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (message) => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text());
        }
    });

    page.on('pageerror', (error) => {
        pageErrors.push(error.message);
    });

    await page.goto('/');

    await expect(page.locator('canvas').first()).toBeVisible();
    await page.waitForTimeout(3000);

    expect(
        { consoleErrors, pageErrors },
        `Runtime errors detected:\nconsole=${consoleErrors.join('\n')}\npage=${pageErrors.join('\n')}`,
    ).toEqual({ consoleErrors: [], pageErrors: [] });
});
