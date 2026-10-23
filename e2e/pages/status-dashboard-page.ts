import type { Locator, Page } from "@playwright/test";

export class StatusDashboardPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/");
  }

  async searchService(name: string) {
    await this.page.getByRole("searchbox", { name: "サービスを検索" }).fill(name);
  }

  async openServiceSelector() {
    await this.page.getByText("表示サービスを選択", { exact: true }).click();
  }

  serviceChoices(): Locator {
    return this.page.getByRole("group", { name: "表示するサービス" });
  }

  serviceSelectorCheckbox(name: string): Locator {
    return this.page.getByRole("checkbox", { name });
  }

  applyServiceSelectionButton(): Locator {
    return this.page.getByRole("button", { name: "この条件で表示" });
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
