import type { Locator, Page } from "@playwright/test";

export class StatusDashboardPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/");
  }

  async searchService(name: string) {
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
    return this.page.getByRole("listitem").filter({ has: this.serviceLink(name) });
  }

  recentUpdates(): Locator {
    return this.page.getByRole("region", { name: "最近の更新" });
  }

  recentIncidentLink(title: string): Locator {
    return this.recentUpdates().getByRole("link", { name: title });
  }
}
