import type { Locator, Page } from "@playwright/test";

export class StatusDashboardPage {
  constructor(private readonly page: Page) {}

  async goto(path = "/") {
    await this.page.goto(path);
  }

  serviceSidebar(): Locator {
    return this.page.getByRole("complementary", { name: "サービス選択" });
  }

  serviceSelection(name: string): Locator {
    return this.serviceSidebar().getByRole("button", { name, exact: true });
  }

  async searchService(name: string) {
    if (await this.serviceSidebar().isVisible()) {
      await this.serviceSidebar().getByRole("searchbox", { name: "サービス一覧を検索" }).fill(name);
      return;
    }

    await this.page.getByRole("searchbox", { name: "サービスを検索" }).fill(name);
  }

  serviceCount(count: number): Locator {
    return this.page.getByText(`${count}サービス`, { exact: true });
  }

  serviceLink(name: string): Locator {
    return this.page.getByRole("link", {
      name: `${name}の公式ステータスページを新しいタブで開く`,
    });
  }

  serviceCard(name: string): Locator {
    return this.page.getByRole("listitem", { name: `${name}のサービス状況` });
  }

  recentUpdates(): Locator {
    return this.page.getByRole("region", { name: "最近の更新" });
  }

  recentIncidentLink(title: string): Locator {
    return this.recentUpdates().getByRole("link", { name: title });
  }
}
