import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the AI provider init (no DB needed)
vi.mock("./lib/ai-provider", () => ({
  loadAiProviderFromDb: vi.fn().mockResolvedValue(undefined),
}));

// Mock invokeLLM — each test sets its own response via the `currentResponse` ref.
const llmResponse: { text: string } = { text: "" };
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(async () => ({
    id: "test",
    created: 0,
    model: "test",
    choices: [{ index: 0, message: { role: "assistant", content: llmResponse.text }, finish_reason: "stop" }],
  })),
}));

import { generateAllContent } from "./shopee-optimizer";

describe("generateAllContent", () => {
  beforeEach(() => {
    llmResponse.text = "";
  });

  it("returns title, description and one variationName per input variation (happy path)", async () => {
    llmResponse.text = JSON.stringify({
      title: "Saco de Lixo Tóxico Laranja 15L Pacote 100 Unidades Hospitalar",
      description:
        "• Conforme ABNT NBR 9191 e normas ANVISA\n• Ideal para resíduos químicos do Grupo B\n• Material resistente, não vaza\n• Pacote profissional com 100 unidades\n• Compre agora e garanta estoque para sua clínica.",
      variationNames: [
        { originalLabel: "1 Un", generatedName: "100un Saco 15L" },
        { originalLabel: "Kit 2", generatedName: "200un Saco 15L" },
      ],
    });

    const result = await generateAllContent({
      productName: "Saco Lixo Tóxico 15L",
      category: "Sacos de Lixo",
      variationType: "Quantidade",
      variations: [
        { label: "1 Un", qty: 100, price: "35" },
        { label: "Kit 2", qty: 200, price: "68" },
      ],
    });

    expect(result.title).toBe("Saco de Lixo Tóxico Laranja 15L Pacote 100 Unidades Hospitalar");
    expect(result.title.length).toBeLessThanOrEqual(120);
    expect(result.description.length).toBeGreaterThan(100);
    expect(result.variationNames).toHaveLength(2);
    expect(result.variationNames[0]).toEqual({ originalLabel: "1 Un", generatedName: "100un Saco 15L" });
    expect(result.variationNames[1]).toEqual({ originalLabel: "Kit 2", generatedName: "200un Saco 15L" });
  });

  it("truncates generated names longer than 20 chars", async () => {
    llmResponse.text = JSON.stringify({
      title: "Título normal",
      description: "Descrição de tamanho normal suficiente para passar no filtro da Shopee com alguns detalhes",
      variationNames: [
        { originalLabel: "1 Un", generatedName: "NomeMuitoLongoQueExcedeLimiteDeVinteCaracteres" },
      ],
    });

    const result = await generateAllContent({
      productName: "Produto",
      variationType: "Qtd",
      variations: [{ label: "1 Un" }],
    });

    expect(result.variationNames[0].generatedName.length).toBeLessThanOrEqual(20);
  });

  it("truncates title longer than 120 chars", async () => {
    llmResponse.text = JSON.stringify({
      title: "A".repeat(200),
      description: "Descrição válida com tamanho razoável para a Shopee aceitar tranquilamente no teste.",
      variationNames: [{ originalLabel: "X", generatedName: "X" }],
    });

    const result = await generateAllContent({
      productName: "Produto",
      variationType: "Qtd",
      variations: [{ label: "X" }],
    });

    expect(result.title.length).toBe(120);
  });

  it("realigns variationNames to source labels when model reorders them", async () => {
    // Model returned variations in a different order AND with one label mismatched.
    llmResponse.text = JSON.stringify({
      title: "Título",
      description: "Descrição longa suficiente para o teste passar na validação mínima do parser 123 456.",
      variationNames: [
        { originalLabel: "Kit 2", generatedName: "Segundo" },
        { originalLabel: "WRONG", generatedName: "Primeiro" }, // model mangled originalLabel
      ],
    });

    const result = await generateAllContent({
      productName: "Produto",
      variationType: "Qtd",
      variations: [
        { label: "1 Un" },
        { label: "Kit 2" },
      ],
    });

    // Output must always echo the source labels, byte-for-byte.
    expect(result.variationNames.map((v) => v.originalLabel)).toEqual(["1 Un", "Kit 2"]);
    // Kit 2 matched by label → "Segundo"; "1 Un" had no match, falls back to positional → "Primeiro"
    expect(result.variationNames[0].generatedName).toBe("Primeiro");
    expect(result.variationNames[1].generatedName).toBe("Segundo");
  });

  it("parses JSON wrapped in markdown code fence", async () => {
    llmResponse.text = '```json\n' + JSON.stringify({
      title: "Título válido",
      description: "Descrição válida e suficientemente longa para o parser considerar aceitável no teste final ok.",
      variationNames: [{ originalLabel: "1 Un", generatedName: "1 Un" }],
    }) + '\n```';

    const result = await generateAllContent({
      productName: "Produto",
      variationType: "Qtd",
      variations: [{ label: "1 Un" }],
    });

    expect(result.title).toBe("Título válido");
  });

  it("falls back to regex extraction when the model adds chatter before/after the JSON", async () => {
    llmResponse.text =
      "Claro! Aqui está o conteúdo:\n\n" +
      JSON.stringify({
        title: "Título",
        description: "Descrição razoavelmente longa para passar no teste final sem falhar por tamanho mínimo.",
        variationNames: [{ originalLabel: "A", generatedName: "A" }],
      }) +
      "\n\nEspero que ajude!";

    const result = await generateAllContent({
      productName: "Produto",
      variationType: "Qtd",
      variations: [{ label: "A" }],
    });

    expect(result.title).toBe("Título");
  });

  it("throws a descriptive error when the response is not JSON at all", async () => {
    llmResponse.text = "Desculpe, não consegui gerar o conteúdo desta vez.";

    await expect(
      generateAllContent({
        productName: "Produto",
        variationType: "Qtd",
        variations: [{ label: "A" }],
      }),
    ).rejects.toThrow(/não é JSON válido/);
  });

  it("rejects when variations array is empty", async () => {
    await expect(
      generateAllContent({
        productName: "Produto",
        variationType: "Qtd",
        variations: [],
      }),
    ).rejects.toThrow(/variations array is empty/);
  });

  it("rejects when productName is missing or empty", async () => {
    await expect(
      generateAllContent({
        productName: "",
        variationType: "Qtd",
        variations: [{ label: "A" }],
      }),
    ).rejects.toThrow(/productName is required/);
  });
});
