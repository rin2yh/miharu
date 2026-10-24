import { expect, test } from "./fixtures/test";

test("サービス名で障害サービスを検索し、障害詳細と最近の更新を確認できる", async ({
  dashboardStatus,
  page,
  statusDashboard,
}) => {
  const { incidentTitle, incidentUrl } = dashboardStatus;
  await test.step("サービス名で検索する", async () => {
    await statusDashboard.goto();
    await expect(
      statusDashboard.serviceSidebar().getByRole("searchbox", { name: "サービス一覧を検索" }),
    ).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "サービスを検索" })).not.toBeVisible();
    await statusDashboard.searchService("GitHub");

    await expect(statusDashboard.serviceSelection("Slack")).toHaveCount(0);
    await expect(statusDashboard.selectedServiceCount(7)).toBeVisible();
    await expect(page.getByText(/^\d+サービス$/)).toHaveCount(0);
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

test("共有URLからサービスを追加・解除し、再読み込みと戻る操作で選択を復元できる", async ({
  dashboardStatus,
  page,
  statusDashboard,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  await test.step("共有URLを開いてSlackとGitHubの選択を確認する", async () => {
    await statusDashboard.goto("/?services=github,slack");
    await expect(statusDashboard.selectedServiceCount(2)).toBeVisible();
    await expect(statusDashboard.serviceLink("GitHub")).toBeVisible();
    await expect(statusDashboard.serviceLink("Slack")).toBeVisible();
    await expect(statusDashboard.serviceLink("Notion")).toHaveCount(0);
    await expect(statusDashboard.recentIncidentLink(dashboardStatus.incidentTitle)).toBeVisible();
    await expect(statusDashboard.serviceSelection("すべて")).toHaveAttribute(
      "aria-pressed",
      "mixed",
    );
  });

  await test.step("Notionを追加してからGitHubを解除する", async () => {
    await statusDashboard.serviceSelection("Notion").click();
    await expect(statusDashboard.selectedServiceCount(3)).toBeVisible();
    await expect(statusDashboard.serviceLink("Notion")).toBeVisible();
    await expect(page).toHaveURL(/services=slack%2Cnotion%2Cgithub/);

    await statusDashboard.serviceSelection("GitHub").click();
    await expect(statusDashboard.selectedServiceCount(2)).toBeVisible();
    await expect(statusDashboard.serviceLink("GitHub")).toHaveCount(0);
    await expect(statusDashboard.recentIncidentLink(dashboardStatus.incidentTitle)).toHaveCount(0);
    await expect(page).toHaveURL(/services=slack%2Cnotion/);
  });

  await test.step("再読み込み後も変更後の選択を表示する", async () => {
    await page.reload();
    expect(new URL(page.url()).searchParams.get("services")).toBe("slack,notion");
    await expect(statusDashboard.selectedServiceCount(2)).toBeVisible();
    await expect(statusDashboard.serviceLink("Slack")).toBeVisible();
    await expect(statusDashboard.serviceLink("Notion")).toBeVisible();
    await expect(statusDashboard.serviceSelection("GitHub")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(statusDashboard.serviceSelection("Notion")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(statusDashboard.recentIncidentLink(dashboardStatus.incidentTitle)).toHaveCount(0);
  });

  await test.step("戻る操作でGitHubを含む一つ前の選択を復元する", async () => {
    await page.goBack();
    await expect(page).toHaveURL(/services=slack%2Cnotion%2Cgithub/);
    await expect(statusDashboard.selectedServiceCount(3)).toBeVisible();
    await expect(statusDashboard.serviceLink("Notion")).toBeVisible();
    await expect(statusDashboard.serviceSelection("GitHub")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(statusDashboard.recentIncidentLink(dashboardStatus.incidentTitle)).toBeVisible();

    await page.goBack();
    expect(new URL(page.url()).searchParams.get("services")).toBe("github,slack");
    await expect(statusDashboard.selectedServiceCount(2)).toBeVisible();
    await expect(statusDashboard.serviceLink("GitHub")).toBeVisible();
    await expect(statusDashboard.serviceLink("Slack")).toBeVisible();
    await expect(statusDashboard.serviceLink("Notion")).toHaveCount(0);
    await expect(statusDashboard.recentIncidentLink(dashboardStatus.incidentTitle)).toBeVisible();
  });
});

test("サービス稼働状況の見出しと更新操作がPC・モバイルで崩れない", async ({
  page,
  statusDashboard,
}) => {
  const heading = page.getByRole("heading", { name: "サービス稼働状況" });
  const refreshButton = page.getByRole("button", { name: "手動更新" });

  await test.step("PCでは見出しとボタンの中心をそろえ、件数を重複表示しない", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await statusDashboard.goto();
    await expect(heading).toBeVisible();
    await expect(refreshButton).toBeVisible();
    await expect(page.getByText(/^\d+サービス$/)).toHaveCount(0);

    const headingBox = await heading.boundingBox();
    const buttonBox = await refreshButton.boundingBox();
    expect(headingBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(
      Math.abs(headingBox!.y + headingBox!.height / 2 - (buttonBox!.y + buttonBox!.height / 2)),
    ).toBeLessThanOrEqual(1);
    expect(buttonBox!.height).toBeLessThanOrEqual(40);
  });

  await test.step("モバイルでは検索と40pxの更新操作を保ち、重ねない", async () => {
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(statusDashboard.serviceSidebar()).not.toBeVisible();
    await expect(page.getByRole("searchbox", { name: "サービスを検索" })).toBeVisible();

    const headingBox = await heading.boundingBox();
    const buttonBox = await refreshButton.boundingBox();
    expect(headingBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.x).toBeGreaterThanOrEqual(headingBox!.x + headingBox!.width);
    expect(buttonBox!.width).toBeGreaterThanOrEqual(40);
    expect(buttonBox!.height).toBeGreaterThanOrEqual(40);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});

test("低い画面高ではサイドバー全体をスクロールしてサービス一覧を確認できる", async ({
  page,
  statusDashboard,
}) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await statusDashboard.goto();

  const sidebar = statusDashboard.serviceSidebar();
  const brandLink = sidebar.getByRole("link", { name: "miharu ホーム" });
  const lastService = sidebar.getByRole("button", { name: "Google Workspace" });

  await expect(brandLink).toBeVisible();
  await expect(lastService).not.toBeInViewport();

  await lastService.scrollIntoViewIfNeeded();

  await expect(lastService).toBeInViewport();
  await expect(brandLink).not.toBeInViewport();
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
    await expect(page.getByRole("searchbox", { name: "サービスを検索" })).toBeVisible();
    const serviceList = page.getByRole("list", { name: "サービス一覧" });
    await expect(serviceList).toBeVisible();
    await expect(serviceList.getByRole("listitem")).toHaveCount(
      dashboardStatus.payload.services.length,
    );
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
