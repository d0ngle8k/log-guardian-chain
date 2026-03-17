import { test, expect } from "@playwright/test";

test("dashboard and navigation render", async ({ page }) => {
  await page.goto("http://127.0.0.1:8080/");

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Blockchain log storage overview")).toBeVisible();

  await page.getByRole("link", { name: "Log Explorer" }).click();
  await expect(page.getByRole("heading", { name: "Log Explorer" })).toBeVisible();

  await page.getByRole("link", { name: "Verification" }).click();
  await expect(page.getByRole("heading", { name: "Batch Verification" })).toBeVisible();

  await page.getByRole("button", { name: "Connect Phantom" }).first().click();
});
