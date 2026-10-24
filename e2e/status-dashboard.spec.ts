import { expect, test } from "./fixtures/test";

test("サービス名で障害サービスを検索し、障害詳細と最近の更新を確認できる", async ({
  dashboardStatus,
  statusDashboard,
}) => {
  const { incidentTitle, incidentUrl } = dashboardStatus;
  await test.step("サービス名で検索する", async () => {
    await statusDashboard.goto();
    await statusDashboard.searchService("GitHub");

    await expect(statusDashboard.serviceCount(1)).toBeVisible();
    await expect(statusDashboard.serviceLink("GitHub")).toBeVisible();
    await expect(statusDashboard.serviceLink("Slack")).toHaveCount(0);
    await expect(statusDashboard.serviceLink("Notion")).toHaveCount(0);
  });

  await test.step("障害の詳細と公式リンクを確認する", async () => {
    const card = statusDashboard.serviceCard("GitHub");
    await expect(card.getByText("部分障害", { exact: true })).toHaveCount(2);
    await expect(card.getByText("Actionsで一部のジョブ開始が遅延しています。")).toBeVisible();
    const summary = card.locator("summary").filter({ hasText: incidentTitle });
    const incidentBody = card.getByText(
      "We are investigating delayed job starts for some GitHub Actions workflows.",
    );
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("調査中");
    await expect(summary).toContainText("更新");
    await expect(incidentBody).not.toBeVisible();
    await summary.focus();
    await expect(summary).toBeFocused();
    await summary.press("Enter");
    await expect(incidentBody).toBeVisible();
    await expect(card.getByRole("link", { name: "公式情報を見る" })).toHaveAttribute(
      "href",
      incidentUrl,
    );
  });

  await test.step("最近の更新に障害が掲載されていることを確認する", async () => {
    const recentUpdates = statusDashboard.recentUpdates();
    const updateLink = statusDashboard.recentIncidentLink(incidentTitle);
    await expect(updateLink).toBeVisible();
    const updateRow = recentUpdates.getByRole("listitem");
    await expect(updateRow).toContainText("GitHub");
    await expect(updateRow).toContainText("障害更新");
    await expect(updateLink).toHaveAttribute("href", incidentUrl);
  });
});

test("PCではサイドバーの選択がURL、サービス一覧、最近の更新に反映される", async ({
  dashboardStatus,
  page,
  statusDashboard,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await statusDashboard.goto("/?services=github,slack");

  const sidebar = statusDashboard.serviceSidebar();
  await expect(sidebar).toBeVisible();
  await expect(statusDashboard.serviceCount(2)).toBeVisible();
  await expect(statusDashboard.serviceLink("GitHub")).toBeVisible();
  await expect(statusDashboard.serviceLink("Slack")).toBeVisible();
  await expect(statusDashboard.serviceLink("Notion")).toHaveCount(0);
  await expect(statusDashboard.recentIncidentLink(dashboardStatus.incidentTitle)).toBeVisible();
  const sidebarBox = await sidebar.boundingBox();
  const divider = page.getByRole("separator");
  const dividerBox = await divider.boundingBox();
  const serviceListBox = await page.getByRole("list", { name: "サービス一覧" }).boundingBox();
  const historyBox = await statusDashboard.recentUpdates().boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(dividerBox).not.toBeNull();
  expect(serviceListBox).not.toBeNull();
  expect(historyBox).not.toBeNull();
  expect(dividerBox!.x).toBeGreaterThan(sidebarBox!.x + sidebarBox!.width);
  expect(serviceListBox!.x).toBeGreaterThan(dividerBox!.x + dividerBox!.width);
  expect(dividerBox!.y + dividerBox!.height).toBe(historyBox!.y + historyBox!.height);
  await expect(statusDashboard.serviceSelection("GitHub")).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(statusDashboard.serviceSelection("Notion")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );

  await statusDashboard.serviceSelection("Notion").click();
  await expect(statusDashboard.serviceCount(3)).toBeVisible();
  await expect(statusDashboard.serviceLink("Notion")).toBeVisible();
  await expect(page).toHaveURL(/services=slack%2Cnotion%2Cgithub/);

  await statusDashboard.serviceSelection("GitHub").click();
  await expect(statusDashboard.serviceCount(2)).toBeVisible();
  await expect(statusDashboard.serviceLink("GitHub")).toHaveCount(0);
  await expect(statusDashboard.recentIncidentLink(dashboardStatus.incidentTitle)).toHaveCount(0);
  await expect(page).toHaveURL(/services=slack%2Cnotion/);

  await page.goBack();
  await expect(statusDashboard.serviceLink("GitHub")).toBeVisible();
  await expect(statusDashboard.recentIncidentLink(dashboardStatus.incidentTitle)).toBeVisible();
  await page.reload();
  await expect(statusDashboard.serviceCount(3)).toBeVisible();
  await expect(statusDashboard.serviceSelection("GitHub")).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await statusDashboard.serviceSelection("すべて").click();
  await expect(page).not.toHaveURL(/services=/);
  await expect(statusDashboard.serviceSelection("すべて")).toHaveAttribute("aria-pressed", "true");
  await expect(statusDashboard.serviceSelection("すべて")).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(statusDashboard.serviceSelection("GitHub")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
});

test("モバイル幅とダークモードでも横スクロールせず一覧を確認できる", async ({
  dashboardStatus,
  page,
  statusDashboard,
}) => {
  await test.step("320px幅のダークモードで画面を開く", async () => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ colorScheme: "dark" });
    await statusDashboard.goto();
  });

  await test.step("サービス一覧が縦並びで表示されることを確認する", async () => {
    await expect(statusDashboard.serviceSidebar()).not.toBeVisible();
    const serviceList = page.getByRole("list", { name: "サービス一覧" });
    await expect(serviceList).toBeVisible();
    await expect(
      statusDashboard.serviceCount(dashboardStatus.payload.services.length),
    ).toBeVisible();
    await expect(statusDashboard.serviceLink("GitHub")).toBeVisible();

    const githubCard = await statusDashboard.serviceCard("GitHub").boundingBox();
    const slackCard = await statusDashboard.serviceCard("Slack").boundingBox();
    expect(githubCard).not.toBeNull();
    expect(slackCard).not.toBeNull();
    expect(slackCard!.y).toBeGreaterThan(githubCard!.y);
  });

  await test.step("横スクロールがなくダークモードが適用されていることを確認する", async () => {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
      "dark",
    );
  });
});
