import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SERVICES } from "../../shared/config/services";
import { ServiceSelector } from "./service-selector";

function openSelector() {
  fireEvent.click(screen.getByText("表示サービスを選択"));
}

describe("ServiceSelector", () => {
  it("shows the initial selected services and marks a partial selection indeterminate", () => {
    const selectedIds = [SERVICES[0]!.id, SERVICES[2]!.id];
    render(
      <ServiceSelector
        selectedServiceIds={selectedIds}
        onApply={vi.fn<(ids: string[]) => void>()}
      />,
    );
    openSelector();

    expect(screen.getByText(`${selectedIds.length}/${SERVICES.length}件`)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: SERVICES[0]!.name })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: SERVICES[1]!.name })).not.toBeChecked();
    expect(
      (screen.getByRole("checkbox", { name: "すべて選択" }) as HTMLInputElement).indeterminate,
    ).toBe(true);
  });

  it("keeps individual changes as a draft and applies selected IDs in service order", () => {
    const onApply = vi.fn<(ids: string[]) => void>();
    const selectedIds = [SERVICES.at(-1)!.id];
    const { rerender } = render(
      <ServiceSelector selectedServiceIds={selectedIds} onApply={onApply} />,
    );
    openSelector();

    fireEvent.click(screen.getByRole("checkbox", { name: SERVICES[0]!.name }));

    expect(screen.getByText("未適用")).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "この条件で表示" }));

    const appliedIds = [SERVICES[0]!.id, SERVICES.at(-1)!.id];
    expect(onApply).toHaveBeenCalledWith(appliedIds);
    rerender(<ServiceSelector selectedServiceIds={appliedIds} onApply={onApply} />);
    expect(screen.queryByText("未適用")).not.toBeInTheDocument();
  });

  it("selects all services and clears the selection", () => {
    render(<ServiceSelector selectedServiceIds={[]} onApply={vi.fn<(ids: string[]) => void>()} />);
    openSelector();
    const selectAll = screen.getByRole("checkbox", { name: "すべて選択" });

    fireEvent.click(selectAll);

    expect(selectAll).toBeChecked();
    expect(selectAll).not.toHaveProperty("indeterminate", true);
    for (const service of SERVICES) {
      expect(screen.getByRole("checkbox", { name: service.name })).toBeChecked();
    }

    fireEvent.click(selectAll);

    expect(selectAll).not.toBeChecked();
    for (const service of SERVICES) {
      expect(screen.getByRole("checkbox", { name: service.name })).not.toBeChecked();
    }
  });

  it("disables Apply and explains the requirement when no services are selected", () => {
    render(<ServiceSelector selectedServiceIds={[]} onApply={vi.fn<(ids: string[]) => void>()} />);
    openSelector();

    expect(screen.getByRole("button", { name: "この条件で表示" })).toBeDisabled();
    expect(screen.getByText("1件以上選択してください。")).toBeInTheDocument();
  });
});
