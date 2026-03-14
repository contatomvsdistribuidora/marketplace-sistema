import { describe, expect, it } from "vitest";
import { parseOrderSourcesToAccounts } from "./baselinker";

describe("parseOrderSourcesToAccounts", () => {
  it("parses order sources into flat account list", () => {
    const sources = {
      personal: { "0": "Pessoalmente / por telefone" },
      shop: { "8005174": "bidu Nuvemshop", "8006537": "nuvem perola" },
      melibr: { "16544": "ML Bidushop", "16545": "ML BELLA COMERCIAL" },
      amazon: { "2557": "Amazon Balao de ofertas" },
      shopeebr: { "16514": "Bidu Shop Utilidadess" },
      order_return: { "0": "Devolução/correção do pedido" },
    };

    const accounts = parseOrderSourcesToAccounts(sources);

    // Should exclude personal and order_return
    expect(accounts.every(a => a.marketplaceType !== "personal")).toBe(true);
    expect(accounts.every(a => a.marketplaceType !== "order_return")).toBe(true);

    // Should include shop, melibr, amazon, shopeebr
    expect(accounts.length).toBe(6); // 2 shop + 2 ML + 1 amazon + 1 shopee

    // Check ML accounts
    const mlAccounts = accounts.filter(a => a.marketplaceType === "melibr");
    expect(mlAccounts.length).toBe(2);
    expect(mlAccounts[0].marketplaceName).toBe("Mercado Livre");
    expect(mlAccounts.some(a => a.name === "ML Bidushop")).toBe(true);
    expect(mlAccounts.some(a => a.name === "ML BELLA COMERCIAL")).toBe(true);

    // Check IDs are formatted correctly
    const mlBidushop = accounts.find(a => a.name === "ML Bidushop");
    expect(mlBidushop?.id).toBe("melibr_16544");

    // Check Amazon
    const amazonAccounts = accounts.filter(a => a.marketplaceType === "amazon");
    expect(amazonAccounts.length).toBe(1);
    expect(amazonAccounts[0].marketplaceName).toBe("Amazon");

    // Check Shopee
    const shopeeAccounts = accounts.filter(a => a.marketplaceType === "shopeebr");
    expect(shopeeAccounts.length).toBe(1);
    expect(shopeeAccounts[0].marketplaceName).toBe("Shopee");
  });

  it("returns empty array for empty sources", () => {
    const accounts = parseOrderSourcesToAccounts({});
    expect(accounts).toEqual([]);
  });

  it("handles unknown marketplace types gracefully", () => {
    const sources = {
      unknown_marketplace: { "123": "Test Account" },
    };

    const accounts = parseOrderSourcesToAccounts(sources);
    expect(accounts.length).toBe(1);
    expect(accounts[0].marketplaceType).toBe("unknown_marketplace");
    expect(accounts[0].name).toBe("Test Account");
  });

  it("sorts by marketplace name then account name", () => {
    const sources = {
      melibr: { "1": "Z Account", "2": "A Account" },
      amazon: { "3": "B Account" },
    };

    const accounts = parseOrderSourcesToAccounts(sources);
    // Amazon comes before Mercado Livre alphabetically
    expect(accounts[0].marketplaceName).toBe("Amazon");
    // Then ML accounts sorted: A Account before Z Account
    expect(accounts[1].name).toBe("A Account");
    expect(accounts[2].name).toBe("Z Account");
  });
});
