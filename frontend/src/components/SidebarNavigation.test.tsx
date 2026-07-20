import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { SidebarNavigation } from "@/components/SidebarNavigation";

test("导航切换时更新活动项，并保留单一移动胶囊", async () => {
  const { container } = render(
    <MemoryRouter initialEntries={["/today"]}>
      <SidebarNavigation
        items={[
          { to: "/today", label: "今日" },
          { to: "/decisions", label: "决策辩论" },
        ]}
        username="admin"
        logoutPending={false}
        logoutError={false}
        onLogout={vi.fn()}
      />
    </MemoryRouter>,
  );

  expect(screen.getByRole("link", { name: "今日" })).toHaveClass("active");
  expect(container.querySelectorAll(".nav-active-pill")).toHaveLength(1);

  await userEvent.click(screen.getByRole("link", { name: "决策辩论" }));

  expect(screen.getByRole("link", { name: "决策辩论" })).toHaveClass("active");
  expect(screen.getByRole("link", { name: "今日" })).not.toHaveClass("active");
});
